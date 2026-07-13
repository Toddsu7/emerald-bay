// Integration tests for the check-in engine (0003) against REAL Postgres, run
// in-process via PGlite (WASM). This executes the actual migration SQL — every
// §4 gate, the fair-share clamp (§2.6), cooldown-blocks-queue (§2.5), hours
// (§2.2), and the session/queue lifecycle (§5).
//
// NOTE ON CONCURRENCY: PGlite is a single connection, so the lake row lock's
// true serialization under simultaneous taps cannot be exercised here (that needs
// two live connections against hosted Postgres — see the handoff). Everything
// else — the gate logic and all state transitions — is validated for real.

import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = [
  '0001_initial_schema.sql',
  '0002_seed_lakes_and_config.sql',
  '0003_checkin_engine.sql',
];

// A fixed "day": 2026-07-12. Sunrise 11:00Z (06:00 CDT), sunset 01:00Z+1 (20:00 CDT).
const CIVIL = '2026-07-12';
const SUNRISE = '2026-07-12T11:00:00Z';
const SUNSET = '2026-07-13T01:00:00Z';
const NOON_LOCAL = '2026-07-12T18:00:00Z'; // 13:00 CDT — inside every window
const BEFORE_10AM = '2026-07-12T14:30:00Z'; // 09:30 CDT — before the jet-ski floor

let sticker = 100;

async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  // Supabase roles referenced by the grants in 0003.
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const f of MIGRATIONS) {
    let sql = readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8');
    // gen_random_uuid() is core in PG13+; pgcrypto isn't bundled in PGlite.
    sql = sql.replace(/^\s*create extension[^;]*;/gim, '');
    await db.exec(sql);
  }
  await db.query(
    'insert into sun_times (civil_date, sunrise, sunset) values ($1,$2,$3)',
    [CIVIL, SUNRISE, SUNSET],
  );
  sticker = 100;
  return db;
}

async function lakeId(db: PGlite, name: 'East' | 'West'): Promise<string> {
  const r = await db.query<{ id: string }>('select id from lakes where name = $1', [name]);
  return r.rows[0].id;
}

interface HullSpec {
  type?: string;
  checkinable?: boolean;
  active?: boolean;
}

async function seedHousehold(
  db: PGlite,
  name: string,
  hulls: HullSpec[],
): Promise<{ hh: string; members: string[]; hullIds: string[] }> {
  const hh = (
    await db.query<{ id: string }>('insert into households (name) values ($1) returning id', [name])
  ).rows[0].id;
  const m1 = (
    await db.query<{ id: string }>(
      "insert into members (household_id, first_name, last_name, email) values ($1,'Primary',$2,$3) returning id",
      [hh, name, `${name}1@example.com`],
    )
  ).rows[0].id;
  const m2 = (
    await db.query<{ id: string }>(
      "insert into members (household_id, first_name, last_name, email) values ($1,'Second',$2,$3) returning id",
      [hh, name, `${name}2@example.com`],
    )
  ).rows[0].id;
  const hullIds: string[] = [];
  for (const h of hulls) {
    const type = h.type ?? 'Pontoon';
    const checkinable = h.checkinable ?? true;
    const active = h.active ?? true;
    const r = await db.query<{ id: string }>(
      'insert into watercraft (household_id, sticker_number, craft_type, is_checkinable, active) values ($1,$2,$3,$4,$5) returning id',
      [hh, sticker++, type, checkinable, active],
    );
    hullIds.push(r.rows[0].id);
  }
  return { hh, members: [m1, m2], hullIds };
}

function hullPayload(ids: string[]): string {
  return JSON.stringify(ids.map((id) => ({ watercraft_id: id })));
}

async function checkIn(
  db: PGlite,
  lake: string,
  hh: string,
  member: string,
  ids: string[],
  now = NOON_LOCAL,
): Promise<string> {
  const r = await db.query<{ check_in: string }>(
    'select check_in($1,$2,$3,$4::jsonb,$5::timestamptz) as check_in',
    [lake, hh, member, hullPayload(ids), now],
  );
  return r.rows[0].check_in;
}

/** Assert an RPC call rejects with a given engine error code. */
async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toThrow(code);
}

async function openHulls(db: PGlite, lake: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    'select count(*)::int as n from session_watercraft sw join sessions s on s.id = sw.session_id where s.lake_id = $1 and s.ended_at is null',
    [lake],
  );
  return r.rows[0].n;
}

describe('check-in gates (§4)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('happy path: checks in one boat and holds a slot', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{ type: 'Pontoon' }]);
    const session = await checkIn(db, east, a.hh, a.members[0], [a.hullIds[0]]);
    expect(session).toBeTruthy();
    expect(await openHulls(db, east)).toBe(1);
  });

  it('gate 6 LAKE_FULL: East caps at 4 hulls', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}, {}, {}, {}]); // 4 hulls, no queue → allowed
    await checkIn(db, east, a.hh, a.members[0], a.hullIds);
    expect(await openHulls(db, east)).toBe(4);
    const b = await seedHousehold(db, 'Bravo', [{}]);
    await expectCode(checkIn(db, east, b.hh, b.members[0], b.hullIds), 'LAKE_FULL');
  });

  it('gate 1 SUSPENDED blocks check-in', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    await db.query("update households set status='suspended' where id=$1", [a.hh]);
    await expectCode(checkIn(db, east, a.hh, a.members[0], a.hullIds), 'SUSPENDED');
  });

  it('gate 2 COOLDOWN blocks check-in', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    await db.query(
      'insert into cooldowns (household_id, expires_at) values ($1, $2)',
      [a.hh, '2026-07-12T19:00:00Z'], // after NOON_LOCAL
    );
    await expectCode(checkIn(db, east, a.hh, a.members[0], a.hullIds), 'COOLDOWN');
  });

  it('gate 3 INVALID_HULL: another household’s hull, and a non-checkinable hull', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    const b = await seedHousehold(db, 'Bravo', [{ type: 'E-Foil', checkinable: false }]);
    // Alpha trying to use Bravo's hull
    await expectCode(checkIn(db, east, a.hh, a.members[0], b.hullIds), 'INVALID_HULL');
    // Bravo trying to check in an E-Foil (never checkinable, §2.3)
    await expectCode(checkIn(db, east, b.hh, b.members[0], b.hullIds), 'INVALID_HULL');
  });

  it('gate 4 HULL_IN_USE: a hull can’t be in two open sessions', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    await checkIn(db, east, a.hh, a.members[0], a.hullIds);
    await expectCode(checkIn(db, east, a.hh, a.members[1], a.hullIds), 'HULL_IN_USE');
  });

  it('gate 5 OUT_OF_HOURS: a jet ski before 10:00 AM is refused', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{ type: 'Jet Ski' }]);
    await expectCode(
      checkIn(db, east, a.hh, a.members[0], a.hullIds, BEFORE_10AM),
      'OUT_OF_HOURS',
    );
    // a Pontoon at the same instant (already past sunrise−30) is fine
    const b = await seedHousehold(db, 'Bravo', [{ type: 'Pontoon' }]);
    const s = await checkIn(db, east, b.hh, b.members[0], b.hullIds, BEFORE_10AM);
    expect(s).toBeTruthy();
  });

  it('SUN_TIMES_MISSING: no sun row → refuse (never a false clear)', async () => {
    const east = await lakeId(db, 'East');
    await db.query('delete from sun_times');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    await expectCode(checkIn(db, east, a.hh, a.members[0], a.hullIds), 'SUN_TIMES_MISSING');
  });
});

describe('fair-share clamp (§2.6)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('a queue join drops the cap and clamps the over-cap household', async () => {
    const east = await lakeId(db, 'East');
    const millers = await seedHousehold(db, 'Millers', [{}, {}, {}]); // 3 out, no queue → OK
    await checkIn(db, east, millers.hh, millers.members[0], millers.hullIds);
    expect(await openHulls(db, east)).toBe(3);

    const you = await seedHousehold(db, 'You', [{}]);
    await db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
      east,
      you.hh,
      you.members[0],
      NOON_LOCAL,
    ]);

    // cap is now floor(4 / (1 on water + 1 waiting)) = 2 → Millers are over.
    const cap = await db.query<{ c: number }>('select _current_cap($1) as c', [east]);
    expect(cap.rows[0].c).toBe(2);

    // Millers' sessions are flagged last_call and given a hard end; nobody kicked.
    const clamp = await db.query<{ last_call: boolean; hard_end_at: string | null }>(
      'select last_call, hard_end_at from sessions where household_id=$1 and ended_at is null',
      [millers.hh],
    );
    expect(clamp.rows[0].last_call).toBe(true);
    expect(clamp.rows[0].hard_end_at).not.toBeNull();
    expect(await openHulls(db, east)).toBe(3); // still on the water

    // Millers cannot start a 4th under the clamp.
    const extra = await seedHousehold(db, 'MillersExtra', []); // no-op holder
    void extra;
    const more = await db.query<{ id: string }>(
      'insert into watercraft (household_id, sticker_number, craft_type, is_checkinable) values ($1,$2,$3,true) returning id',
      [millers.hh, sticker++, 'Pontoon'],
    );
    await expectCode(
      checkIn(db, east, millers.hh, millers.members[0], [more.rows[0].id]),
      'OVER_CAP',
    );
  });
});

describe('the exploit fix (§2.5): cooldown is household-level and blocks queueing', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('after a queued-out session ends, NO member of the household can re-enter or queue', async () => {
    const east = await lakeId(db, 'East');
    // Dad checks in the family boat.
    const fam = await seedHousehold(db, 'Family', [{}]);
    const session = await checkIn(db, east, fam.hh, fam.members[0], fam.hullIds);

    // A queue forms (someone waiting) → the session gets a hard end.
    const other = await seedHousehold(db, 'Other', [{}, {}, {}, {}]);
    void other;
    await db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
      east,
      other.hh,
      other.members[0],
      NOON_LOCAL,
    ]);

    // The family's session ends (queued out) → household cooldown created.
    await db.query('select end_session($1,$2,$3::timestamptz)', [
      session,
      'auto_expire',
      '2026-07-12T18:30:00Z',
    ]);
    const cd = await db.query<{ n: number }>(
      'select count(*)::int as n from cooldowns where household_id=$1',
      [fam.hh],
    );
    expect(cd.rows[0].n).toBe(1);

    const later = '2026-07-12T18:35:00Z';
    // Daughter (member 2, different login, SAME household) tries the same boat.
    await expectCode(
      checkIn(db, east, fam.hh, fam.members[1], fam.hullIds, later),
      'COOLDOWN',
    );
    // And she cannot even join the queue.
    await expectCode(
      db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
        east,
        fam.hh,
        fam.members[1],
        later,
      ]),
      'COOLDOWN',
    );

    // A no-checkout violation was auto-FLAGGED (never auto-fined).
    const v = await db.query<{ status: string; fine_amount: number | null }>(
      "select status, fine_amount from violations where household_id=$1 and kind='no_checkout'",
      [fam.hh],
    );
    expect(v.rows[0].status).toBe('flagged');
    expect(v.rows[0].fine_amount).toBeNull();
  });
});

describe('queue offer / accept lifecycle (§2.7, §5)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('slot opens → sweep offers #1 → LAUNCH starts their session', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}, {}, {}, {}]); // fills the lake
    await checkIn(db, east, a.hh, a.members[0], a.hullIds);

    const b = await seedHousehold(db, 'Bravo', [{}]);
    await db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
      east,
      b.hh,
      b.members[0],
      NOON_LOCAL,
    ]);

    // Alpha's sessions got a hard end; end them to open slots, then sweep.
    await db.query(
      "update sessions set ended_at=$2, ended_reason='user' where household_id=$1 and ended_at is null",
      [a.hh, '2026-07-12T18:40:00Z'],
    );
    await db.query('select sweep($1::timestamptz)', ['2026-07-12T18:41:00Z']);

    const offered = await db.query<{ status: string; id: string }>(
      "select id, status from queue_entries where household_id=$1",
      [b.hh],
    );
    expect(offered.rows[0].status).toBe('offered');

    // Bravo taps LAUNCH.
    const s = await db.query<{ accept_offer: string }>(
      'select accept_offer($1,$2,$3::jsonb,$4::timestamptz) as accept_offer',
      [offered.rows[0].id, b.members[0], hullPayload(b.hullIds), '2026-07-12T18:42:00Z'],
    );
    expect(s.rows[0].accept_offer).toBeTruthy();
    const launched = await db.query<{ status: string }>(
      'select status from queue_entries where id=$1',
      [offered.rows[0].id],
    );
    expect(launched.rows[0].status).toBe('launched');
    expect(await openHulls(db, east)).toBe(1);
  });
});
