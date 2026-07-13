/**
 * Zoho → Supabase import (BUILD SPEC §10, build step 2). Idempotent & re-runnable.
 *
 * SOURCE: a SINGLE merged CSV, ./data/emerald_bay_residents.csv (the two Zoho
 * export pages are already merged + deduped upstream). UTF-8 with BOM.
 *
 * WHAT IT DOES
 *   - Seeds households + their primary contact (from the "Name" + "Email" +
 *     "Cell Phone" columns). Additional members self-register via the app (§7).
 *   - Seeds watercraft, FILTERED to "Watercraft N Status == 'Registering for 2026'"
 *     (→ 196 active hulls). All other statuses are stale and are the source of every
 *     apparent sticker "duplicate" (§10) — excluding them resolves all of them.
 *   - is_checkinable derived from craft type: E-Foil / Sail boat / Other → false.
 *   - Ignores "Number of Watercraft" (unreliable); counts actual hull rows.
 *
 * COLUMN QUIRKS (confirmed against the real export header, 2026):
 *   - Hull 1 craft type = "Type of Watercraft" (no suffix); hulls 2–5 suffixed.
 *   - Sticker columns are "2024 Sticker Number 1..5" — despite the name, current.
 *   - Manufacturer: hull 1 = "Manufacturer 1" (with the r); hulls 2–5 =
 *     "Manufacture N" (no r), and hull 2's header carries a double space.
 *   - No Year and no Hull-ID/HIN columns exist → stored null.
 *
 * SELF-CHECK: stops unless it parses EXACTLY 187 households / 196 hulls, with all
 * stickers 100–350, no duplicates, and every household holding an email (§10).
 *
 * USAGE
 *   npm run import -- --dry-run     # parse + validate, write nothing
 *   npm run import                  # apply (needs SUPABASE_SERVICE_ROLE_KEY)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { CRAFT_TYPES, isCheckinableType, type CraftType } from '../lib/types';

try {
  (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.('.env.local');
} catch {
  /* env may already be present */
}

const DRY_RUN = process.argv.includes('--dry-run');
const CSV_PATH = resolve(process.cwd(), 'data', 'emerald_bay_residents.csv');

// Expected totals for this export — a mismatch means the source or mapping changed;
// stop rather than import a wrong roster (per the hand-off instruction).
const EXPECTED_HOUSEHOLDS = 187;
const EXPECTED_HULLS = 196;
const REGISTERING_2026 = 'Registering for 2026';

type Row = Record<string, string>;

// ── Household / primary-contact columns ──────────────────────────────────────
const COL = {
  recordId: ['Record Id'],
  name: ['Name'],
  address: ['Address', 'Emerald Bay Address'],
  email: ['Email'],
  mobile: ['Cell Phone'],
};

/** hull index 1..5 → the real column names (suffix + manufacturer quirks). */
function hullCols(n: number) {
  const s = ` ${n}`;
  return {
    status: [`Watercraft ${n} Status`],
    type: [n === 1 ? 'Type of Watercraft' : `Type of Watercraft ${n}`],
    sticker: [`2024 Sticker Number ${n}`],
    manufacturer:
      n === 1
        ? ['Manufacturer 1', 'Manufacture 1']
        : [`Manufacture ${n}`, `Manufacture  ${n}`, `Manufacture  ${n}`, `Manufacturer ${n}`],
    model: [`Model ${n}`],
    length: [`Length ${n}`],
  };
}

function pick(row: Row, candidates: string[]): string {
  for (const c of candidates) {
    if (row[c] != null && String(row[c]).trim() !== '') return String(row[c]).trim();
  }
  return '';
}

/** Split a "First Last" name into first + last (both required, §7). */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: 'Primary', last: 'Contact' };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
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
    other: 'Other',
  };
  const hit = map[v] ?? map[raw.trim().toLowerCase()];
  if (hit) return { type: hit, known: true };
  const exact = (CRAFT_TYPES as readonly string[]).find((t) => t.toLowerCase() === v);
  if (exact) return { type: exact as CraftType, known: true };
  return { type: 'Other', known: false };
}

interface HullOut {
  sticker: number;
  craftType: CraftType;
  isCheckinable: boolean;
  manufacturer: string | null;
  model: string | null;
  lengthFt: number | null;
}
interface HouseholdOut {
  recordId: string;
  name: string;
  address: string | null;
  primary: { firstName: string; lastName: string; email: string | null; mobile: string | null };
  hulls: HullOut[];
}

function readRows(): Row[] {
  let text: string;
  try {
    text = readFileSync(CSV_PATH, 'utf8');
  } catch {
    throw new Error(`Missing ${CSV_PATH} — put the merged Zoho export there.`);
  }
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    bom: true, // UTF-8 BOM
    relax_column_count: true,
  }) as Row[];
  console.log(`  read ${rows.length} rows from emerald_bay_residents.csv`);
  return rows;
}

function build(rows: Row[]): { households: HouseholdOut[]; warnings: string[] } {
  const households: HouseholdOut[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    const recordId = pick(row, COL.recordId);
    if (!recordId) {
      warnings.push('Row with no Record Id skipped');
      continue;
    }
    const fullName = pick(row, COL.name);
    const { first, last } = splitName(fullName);

    const hulls: HullOut[] = [];
    for (let n = 1; n <= 5; n++) {
      const c = hullCols(n);
      if (pick(row, c.status) !== REGISTERING_2026) continue; // §10 filter
      const typeRaw = pick(row, c.type);
      if (!typeRaw) continue;

      const stickerStr = pick(row, c.sticker);
      const sticker = Number(stickerStr);
      if (!Number.isInteger(sticker)) {
        warnings.push(`${fullName}: hull ${n} has no valid sticker ("${stickerStr}") — skipped`);
        continue;
      }
      const { type, known } = normalizeCraft(typeRaw);
      if (!known) warnings.push(`${fullName}: unknown craft type "${typeRaw}" → Other (not checkinable)`);
      const lenNum = Number(pick(row, c.length));
      hulls.push({
        sticker,
        craftType: type,
        isCheckinable: isCheckinableType(type),
        manufacturer: pick(row, c.manufacturer) || null,
        model: pick(row, c.model) || null,
        lengthFt: Number.isFinite(lenNum) && lenNum > 0 ? lenNum : null,
      });
    }

    households.push({
      recordId,
      name: fullName || `${first} ${last}`.trim(),
      address: pick(row, COL.address) || null,
      primary: { firstName: first, lastName: last, email: pick(row, COL.email) || null, mobile: pick(row, COL.mobile) || null },
      hulls,
    });
  }
  return { households, warnings };
}

function validate(households: HouseholdOut[]): string[] {
  const errors: string[] = [];
  const hulls = households.flatMap((h) => h.hulls);
  const stickers = hulls.map((h) => h.sticker);

  if (households.length !== EXPECTED_HOUSEHOLDS)
    errors.push(`Expected ${EXPECTED_HOUSEHOLDS} households, got ${households.length}`);
  if (hulls.length !== EXPECTED_HULLS)
    errors.push(`Expected ${EXPECTED_HULLS} hulls, got ${hulls.length}`);

  const dupes = stickers.filter((s, i) => stickers.indexOf(s) !== i);
  if (dupes.length) errors.push(`Duplicate stickers after 2026 filter: ${[...new Set(dupes)].join(', ')}`);

  const outOfRange = stickers.filter((s) => s < 100 || s > 350);
  if (outOfRange.length) errors.push(`Stickers out of range 100–350: ${outOfRange.join(', ')}`);

  const noEmail = households.filter((h) => !h.primary.email);
  if (noEmail.length) errors.push(`${noEmail.length} household(s) missing an email`);

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
          length_ft: hull.lengthFt,
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
  const rows = readRows();
  const { households, warnings } = build(rows);
  for (const w of warnings) console.warn('  ⚠', w);
  const errors = validate(households);
  if (errors.length) {
    console.error('\nVALIDATION FAILED — stopping (nothing written):');
    for (const e of errors) console.error('  ✗', e);
    process.exit(1);
  }
  if (DRY_RUN) {
    console.log('\nDry run OK — 187 households / 196 hulls. Nothing written.');
    return;
  }
  await apply(households);
  console.log('\nImport complete.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
