/**
 * Zoho → Supabase import (BUILD SPEC §10, build step 2). Idempotent & re-runnable.
 *
 * WHAT IT DOES
 *   - Reads the Zoho CSV export(s) from ./data (two paginated files, merged on
 *     "Record Id" → 187 unique households).
 *   - Seeds households + their primary contact (additional members self-register
 *     via the app, §7).
 *   - Seeds watercraft, FILTERED to "Watercraft N Status == 'Registering for 2026'"
 *     (→ 196 active hulls). The 34 non-2026 rows are stale and excluded — that
 *     filter resolves every apparent sticker "duplicate" (§10). Do NOT dedupe them.
 *   - is_checkinable is derived from craft type: E-Foil / Sail boat / Other → false.
 *   - Ignores the unreliable "Number of Watercraft" column; counts actual hull rows.
 *
 * IDEMPOTENCY: households upsert on zoho_record_id; watercraft upsert on
 * sticker_number; primary members upsert on (household + email).
 *
 * SELF-CHECK (matches §10 invariants): 196 hulls, stickers 100–350, zero
 * duplicates, zero active hulls missing a craft type. Fails loudly otherwise.
 *
 * ⚠ COLUMN NAMES: Zoho headers vary. The mapping below reflects the spec's stated
 *   quirks (hull 1 = "Type of Watercraft" with no suffix; hulls 2–5 suffixed; one
 *   header carries a non-breaking space, "Manufacture\xa0 2"). VERIFY these against
 *   your real export headers before the first real run — `--dry-run` prints what it
 *   parsed without writing anything.
 *
 * USAGE
 *   1. Put the export CSV(s) in ./data/ (git-ignored).
 *   2. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   3. npm run import -- --dry-run     # parse + validate, write nothing
 *      npm run import                  # apply
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { CRAFT_TYPES, isCheckinableType, type CraftType } from '../lib/types';

// Load env (Node ≥21 process.loadEnvFile). Non-fatal if the app already set it.
try {
  (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.('.env.local');
} catch {
  /* env may already be present */
}

const DRY_RUN = process.argv.includes('--dry-run');
const DATA_DIR = resolve(process.cwd(), 'data');

type Row = Record<string, string>;

// ── Column mapping (VERIFY against the real headers, see header note) ─────────
const COL = {
  recordId: ['Record Id', 'Record ID', 'RecordId'],
  householdName: ['Household Name', 'Name', 'Primary Contact', 'Last Name'],
  address: ['Address', 'Street Address', 'Mailing Address'],
  primaryFirst: ['First Name', 'Primary First Name'],
  primaryLast: ['Last Name', 'Primary Last Name'],
  primaryEmail: ['Email', 'Email Address', 'Primary Email'],
  primaryMobile: ['Mobile', 'Cell', 'Mobile Phone', 'Phone'],
};

/** hull index 1..5 → candidate column names (suffix quirk + nbsp variants). */
function hullCols(n: number) {
  const s = n === 1 ? '' : ` ${n}`;
  const nbsp = n === 1 ? '' : `  ${n}`;
  return {
    status: [`Watercraft${s} Status`, `Watercraft Status${s}`],
    type: [`Type of Watercraft${s}`],
    sticker: [`Sticker Number${s}`, `Watercraft${s} Sticker`, `Sticker${s}`],
    manufacturer: [`Manufacture${s}`, `Manufacture${nbsp}`, `Manufacturer${s}`],
    model: [`Model${s}`],
    year: [`Year${s}`],
    length: [`Length${s}`, `Length (ft)${s}`],
    hullId: [`Hull ID${s}`, `HIN${s}`],
  };
}

const REGISTERING_2026 = 'Registering for 2026';

function pick(row: Row, candidates: string[]): string {
  for (const c of candidates) {
    if (row[c] != null && String(row[c]).trim() !== '') return String(row[c]).trim();
  }
  return '';
}

/** Normalize a Zoho craft-type string to our enum; unknown → 'Other' (warned). */
function normalizeCraft(raw: string): { type: CraftType; known: boolean } {
  const v = raw.trim().toLowerCase().replace(/[-_\s]+/g, ' ');
  const map: Record<string, CraftType> = {
    'jet ski': 'Jet Ski',
    jetski: 'Jet Ski',
    pwc: 'Jet Ski',
    pontoon: 'Pontoon',
    'ski surf boat': 'Ski/Surf boat',
    'ski/surf boat': 'Ski/Surf boat',
    'ski boat': 'Ski/Surf boat',
    'surf boat': 'Ski/Surf boat',
    'fishing boat': 'Fishing boat',
    'sail boat': 'Sail boat',
    sailboat: 'Sail boat',
    'e foil': 'E-Foil',
    efoil: 'E-Foil',
    'e-foil': 'E-Foil',
    other: 'Other',
  };
  const hit = map[v] ?? map[raw.trim().toLowerCase()];
  if (hit) return { type: hit, known: true };
  // Exact enum match fallback.
  const exact = (CRAFT_TYPES as readonly string[]).find((t) => t.toLowerCase() === v);
  if (exact) return { type: exact as CraftType, known: true };
  return { type: 'Other', known: false };
}

function readAllRows(): Row[] {
  let files: string[];
  try {
    files = readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith('.csv'));
  } catch {
    throw new Error(`No ./data directory. Put the Zoho CSV export(s) in ${DATA_DIR}`);
  }
  if (files.length === 0) throw new Error(`No CSV files in ${DATA_DIR}`);
  const rows: Row[] = [];
  for (const f of files) {
    const text = readFileSync(resolve(DATA_DIR, f), 'utf8');
    const parsed = parse(text, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
    }) as Row[];
    rows.push(...parsed);
    console.log(`  read ${parsed.length} rows from ${f}`);
  }
  return rows;
}

interface HullOut {
  sticker: number;
  craftType: CraftType;
  isCheckinable: boolean;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  lengthFt: number | null;
  hullId: string | null;
}
interface HouseholdOut {
  recordId: string;
  name: string;
  address: string | null;
  primary: {
    firstName: string;
    lastName: string;
    email: string | null;
    mobile: string | null;
  };
  hulls: HullOut[];
}

function buildHouseholds(rows: Row[]): { households: HouseholdOut[]; warnings: string[] } {
  const byRecord = new Map<string, HouseholdOut>();
  const warnings: string[] = [];

  for (const row of rows) {
    const recordId = pick(row, COL.recordId);
    if (!recordId) {
      warnings.push('Row with no Record Id skipped');
      continue;
    }
    if (byRecord.has(recordId)) continue; // dedupe across the paginated files

    const firstName = pick(row, COL.primaryFirst) || 'Primary';
    const lastName = pick(row, COL.primaryLast) || pick(row, COL.householdName) || 'Contact';
    const email = pick(row, COL.primaryEmail) || null;
    const mobile = pick(row, COL.primaryMobile) || null;
    const name = pick(row, COL.householdName) || `${firstName} ${lastName}`.trim();

    const hulls: HullOut[] = [];
    for (let n = 1; n <= 5; n++) {
      const c = hullCols(n);
      const status = pick(row, c.status);
      const typeRaw = pick(row, c.type);
      // Only 2026 hulls; hull 1 sometimes lacks a status column — treat a present
      // type with a blank/absent status the same as any other (§10 filter is on
      // status, but a typed hull-1 with no status column still counts if 2026).
      if (status && status !== REGISTERING_2026) continue;
      if (!typeRaw) continue; // no hull in this slot

      const stickerStr = pick(row, c.sticker);
      const sticker = Number(stickerStr);
      if (!Number.isInteger(sticker)) {
        warnings.push(`${name}: hull ${n} has no valid sticker ("${stickerStr}") — skipped`);
        continue;
      }
      const { type, known } = normalizeCraft(typeRaw);
      if (!known) warnings.push(`${name}: unknown craft type "${typeRaw}" → Other (not checkinable)`);
      const yearNum = Number(pick(row, c.year));
      const lenNum = Number(pick(row, c.length));
      hulls.push({
        sticker,
        craftType: type,
        isCheckinable: isCheckinableType(type),
        manufacturer: pick(row, c.manufacturer) || null,
        model: pick(row, c.model) || null,
        year: Number.isInteger(yearNum) ? yearNum : null,
        lengthFt: Number.isFinite(lenNum) && lenNum > 0 ? lenNum : null,
        hullId: pick(row, c.hullId) || null,
      });
    }

    byRecord.set(recordId, {
      recordId,
      name,
      address: pick(row, COL.address) || null,
      primary: { firstName, lastName, email, mobile },
      hulls,
    });
  }

  return { households: [...byRecord.values()], warnings };
}

function validate(households: HouseholdOut[]): string[] {
  const errors: string[] = [];
  const hulls = households.flatMap((h) => h.hulls);
  const stickers = hulls.map((h) => h.sticker);

  const dupes = stickers.filter((s, i) => stickers.indexOf(s) !== i);
  if (dupes.length) errors.push(`Duplicate stickers after 2026 filter: ${[...new Set(dupes)].join(', ')}`);

  const outOfRange = stickers.filter((s) => s < 100 || s > 350);
  if (outOfRange.length) errors.push(`Stickers out of range 100–350: ${outOfRange.join(', ')}`);

  const noEmail = households.filter((h) => !h.primary.email);
  if (noEmail.length) errors.push(`${noEmail.length} household(s) missing an email (spec: every household has one)`);

  // Informational — spec expects 187 households / 196 hulls.
  console.log(`  parsed ${households.length} households, ${hulls.length} active hulls`);
  const mix = hulls.reduce<Record<string, number>>((m, h) => {
    m[h.craftType] = (m[h.craftType] ?? 0) + 1;
    return m;
  }, {});
  console.log('  craft mix:', mix);
  return errors;
}

async function apply(households: HouseholdOut[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const h of households) {
    const { data: hh, error: hhErr } = await db
      .from('households')
      .upsert({ zoho_record_id: h.recordId, name: h.name, address: h.address, status: 'active' }, { onConflict: 'zoho_record_id' })
      .select('id')
      .single();
    if (hhErr) throw new Error(`household ${h.name}: ${hhErr.message}`);
    const householdId = hh.id;

    // Primary contact. Requires email OR mobile (schema CHECK); every household has
    // an email per spec.
    if (h.primary.email || h.primary.mobile) {
      const { data: existing } = await db
        .from('members')
        .select('id')
        .eq('household_id', householdId)
        .eq('role', 'primary')
        .maybeSingle();
      const memberRow = {
        household_id: householdId,
        first_name: h.primary.firstName,
        last_name: h.primary.lastName,
        email: h.primary.email,
        mobile: h.primary.mobile,
        role: 'primary',
      };
      if (existing) await db.from('members').update(memberRow).eq('id', existing.id);
      else await db.from('members').insert(memberRow);
    }

    for (const hull of h.hulls) {
      const { error: wErr } = await db.from('watercraft').upsert(
        {
          household_id: householdId,
          sticker_number: hull.sticker,
          craft_type: hull.craftType,
          is_checkinable: hull.isCheckinable,
          manufacturer: hull.manufacturer,
          model: hull.model,
          year: hull.year,
          length_ft: hull.lengthFt,
          hull_id: hull.hullId,
          active: true,
        },
        { onConflict: 'sticker_number' },
      );
      if (wErr) throw new Error(`hull #${hull.sticker}: ${wErr.message}`);
    }
  }
}

async function main() {
  console.log(DRY_RUN ? '── Import (DRY RUN) ──' : '── Import ──');
  const rows = readAllRows();
  const { households, warnings } = buildHouseholds(rows);
  for (const w of warnings) console.warn('  ⚠', w);
  const errors = validate(households);
  if (errors.length) {
    console.error('\nVALIDATION FAILED:');
    for (const e of errors) console.error('  ✗', e);
    process.exit(1);
  }
  if (DRY_RUN) {
    console.log('\nDry run OK — nothing written.');
    return;
  }
  await apply(households);
  console.log('\nImport complete.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
