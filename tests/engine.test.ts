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
  '0009_continuous_hours.sql', // rebuilds timing on 1-hour blocks (supersedes 0003 fns)
  '0010_flag_no_checkout.sql', // restore no_checkout flag on auto_expire only
  '0012_no_queue_with_room.sql', // reject join_queue when the lake has open slots
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

  it('a queue join (lake full) drops the cap and flags the over-cap household', async () => {
    const east = await lakeId(db, 'East');
    const millers = await seedHousehold(db, 'Millers', [{}, {}, {}, {}]); // 4 → fills East
    await checkIn(db, east, millers.hh, millers.members[0], millers.hullIds);
    expect(await openHulls(db, east)).toBe(4); // full — a queue can now form

    const you = await seedHousehold(db, 'You', [{}]);
    await db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
      east,
      you.hh,
      you.members[0],
      NOON_LOCAL,
    ]);

    // cap is now floor(4 / (1 on water + 1 waiting)) = 2 → Millers (4) are over.
    const cap = await db.query<{ c: number }>('select _current_cap($1) as c', [east]);
    expect(cap.rows[0].c).toBe(2);

    // Millers' session is flagged last_call with a block boundary; nobody kicked.
    const clamp = await db.query<{ last_call: boolean; hard_end_at: string | null }>(
      'select last_call, hard_end_at from sessions where household_id=$1 and ended_at is null',
      [millers.hh],
    );
    expect(clamp.rows[0].last_call).toBe(true);
    expect(clamp.rows[0].hard_end_at).not.toBeNull();
    expect(await openHulls(db, east)).toBe(4); // still on the water
  });
});

describe('no queue when the lake has room (a queue only waits for a slot)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('rejects join_queue with LAKE_HAS_ROOM when slots are open; accepts once full', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);

    // East is empty → nothing to wait for → refused.
    await expectCode(
      db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
        east,
        a.hh,
        a.members[0],
        NOON_LOCAL,
      ]),
      'LAKE_HAS_ROOM',
    );

    // Fill East to capacity (4 hulls), then the same join succeeds.
    const f = await seedHousehold(db, 'Filler', [{}, {}, {}, {}]);
    await checkIn(db, east, f.hh, f.members[0], f.hullIds);
    const q = await db.query<{ id: string }>(
      'select join_queue($1,$2,$3,$4::timestamptz) as id',
      [east, a.hh, a.members[0], NOON_LOCAL],
    );
    expect(q.rows[0].id).toBeTruthy();
  });
});

describe('the exploit fix (§2.5): cooldown is household-level and blocks queueing', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('after a queued-out session ends, NO member of the household can re-enter or queue', async () => {
    const east = await lakeId(db, 'East');
    // Dad checks in the family boat; a filler fills the rest so a queue can form.
    const fam = await seedHousehold(db, 'Family', [{}]);
    const session = await checkIn(db, east, fam.hh, fam.members[0], fam.hullIds);
    const filler = await seedHousehold(db, 'Filler', [{}, {}, {}]);
    await checkIn(db, east, filler.hh, filler.members[0], filler.hullIds); // East 4/4

    // A household waits (lake full → queue allowed).
    const other = await seedHousehold(db, 'Other', [{}]);
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

    // The system ended it (auto_expire while a queue waited) → no_checkout is FLAGGED
    // for board review, never auto-fined.
    const v = await db.query<{ status: string; fine_amount: number | null }>(
      "select status, fine_amount from violations where household_id=$1 and kind='no_checkout'",
      [fam.hh],
    );
    expect(v.rows[0].status).toBe('flagged');
    expect(v.rows[0].fine_amount).toBeNull();
  });
});

describe('continuous 1-hour blocks (rules doc)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  const T = '2026-07-12T18:00:00Z'; // check-in; block boundary → 19:00Z
  const PAST_BOUNDARY = '2026-07-12T19:05:00Z'; // 5 min past the first boundary

  it('auto-renews when no one is waiting — session stays open, boundary advances', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    await checkIn(db, east, a.hh, a.members[0], a.hullIds, T);

    await db.query('select sweep($1::timestamptz)', [PAST_BOUNDARY]);

    const s = await db.query<{ ended_at: string | null; hard_end_at: string }>(
      'select ended_at, hard_end_at from sessions where household_id=$1',
      [a.hh],
    );
    expect(s.rows[0].ended_at).toBeNull(); // still on the water
    expect(new Date(s.rows[0].hard_end_at).toISOString()).toBe('2026-07-12T20:00:00.000Z'); // advanced to +2h

    // Renewal is the system working as designed → NOT flagged.
    const v = await db.query<{ n: number }>(
      "select count(*)::int n from violations where household_id=$1 and kind='no_checkout'",
      [a.hh],
    );
    expect(v.rows[0].n).toBe(0);
  });

  it('ends AT the boundary when someone is waiting → cooldown, no re-entry', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}]);
    await checkIn(db, east, a.hh, a.members[0], a.hullIds, T);
    const filler = await seedHousehold(db, 'Filler', [{}, {}, {}]);
    await checkIn(db, east, filler.hh, filler.members[0], filler.hullIds, T); // East 4/4

    const b = await seedHousehold(db, 'Bravo', [{}]);
    await db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
      east,
      b.hh,
      b.members[0],
      '2026-07-12T18:30:00Z', // queue forms mid-block (lake full → allowed)
    ]);

    await db.query('select sweep($1::timestamptz)', [PAST_BOUNDARY]);

    const s = await db.query<{ ended_at: string | null }>(
      'select ended_at from sessions where household_id=$1',
      [a.hh],
    );
    // ended exactly at the boundary (19:00), not now+something — no grace floor
    expect(s.rows[0].ended_at).not.toBeNull();
    expect(new Date(s.rows[0].ended_at!).toISOString()).toBe('2026-07-12T19:00:00.000Z');

    // household is in cooldown and cannot re-enter
    await expectCode(
      checkIn(db, east, a.hh, a.members[0], a.hullIds, '2026-07-12T19:06:00Z'),
      'COOLDOWN',
    );

    // Force-ended by the system while the member didn't check out → FLAGGED.
    const v = await db.query<{ status: string }>(
      "select status from violations where household_id=$1 and kind='no_checkout'",
      [a.hh],
    );
    expect(v.rows[0]?.status).toBe('flagged');
  });

  it('ended at sunset with no checkout → flagged no_checkout', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{ type: 'Pontoon' }]);
    await checkIn(db, east, a.hh, a.members[0], a.hullIds, T);

    // Sweep well past sunset (SUNSET 01:00Z; a boat runs to sunset+30 = 01:30Z).
    await db.query('select sweep($1::timestamptz)', ['2026-07-13T02:00:00Z']);

    const s = await db.query<{ ended_at: string | null }>(
      'select ended_at from sessions where household_id=$1',
      [a.hh],
    );
    expect(new Date(s.rows[0].ended_at!).toISOString()).toBe('2026-07-13T01:30:00.000Z'); // sunset+30
    const v = await db.query<{ status: string }>(
      "select status from violations where household_id=$1 and kind='no_checkout'",
      [a.hh],
    );
    expect(v.rows[0]?.status).toBe('flagged');
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

describe('fair-share cap gate (§2.6) — OVER_CAP in the transient post-rotation window', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  // Under the continuous-hours model a queue only forms on a FULL lake, so the clean
  // "cap 2 with a spare slot" scenarios no longer occur in steady state. The cap gate
  // still bites in the transient window right after a boat rotates/ends and a slot is
  // open but belongs to the queue: an over-cap household must not grab it.
  it('an over-cap household can’t grab a freed slot ahead of the queue', async () => {
    const east = await lakeId(db, 'East');
    const a = await seedHousehold(db, 'Alpha', [{}, {}, {}]); // 2 out + 1 spare
    await checkIn(db, east, a.hh, a.members[0], [a.hullIds[0]]);
    await checkIn(db, east, a.hh, a.members[0], [a.hullIds[1]]); // Alpha: 2 hulls, 2 sessions
    const b = await seedHousehold(db, 'Bravo', [{}, {}]);
    const bSess = await checkIn(db, east, b.hh, b.members[0], [b.hullIds[0], b.hullIds[1]]);
    expect(await openHulls(db, east)).toBe(4); // full

    // Cara waits (lake full → allowed). cap = floor(4 / (2 on water + 1 waiting)) = 1.
    const c = await seedHousehold(db, 'Cara', [{}]);
    await db.query('select join_queue($1,$2,$3,$4::timestamptz)', [
      east,
      c.hh,
      c.members[0],
      NOON_LOCAL,
    ]);
    expect((await db.query<{ c: number }>('select _current_cap($1) as c', [east])).rows[0].c).toBe(1);

    // Bravo is admin-voided (no cooldown for Bravo) → slots free up for the queue.
    await db.query('select end_session($1,$2,$3::timestamptz)', [
      bSess,
      'admin',
      '2026-07-12T18:40:00Z',
    ]);

    // Alpha holds 2, over its fair-share cap while Cara waits — it can't grab the
    // freed slot with a 3rd hull even though a slot is physically open.
    await expectCode(checkIn(db, east, a.hh, a.members[0], [a.hullIds[2]]), 'OVER_CAP');
  });
});

describe('lock-test scenario is eligible (validates scripts/lock-test.ts setup)', () => {
  it('capacity-1 isolated lake: first check-in wins, second gets LAKE_FULL — no OVER_CAP', async () => {
    const db = await freshDb();

    // Mirror the script: find + drop the name CHECK by its definition (not
    // capacity>0), then create an isolated capacity-1 test lake.
    const con = await db.query<{ conname: string }>(
      `select con.conname from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
        where rel.relname='lakes' and con.contype='c'
          and pg_get_constraintdef(con.oid) like '%East%'`,
    );
    expect(con.rows.length).toBe(1); // the constraint-finder in the script must match exactly one
    await db.exec(`alter table lakes drop constraint "${con.rows[0].conname}"`);
    const lake = (
      await db.query<{ id: string }>(
        "insert into lakes (name, capacity) values ('ZZ_LOCKTEST_LAKE', 1) returning id",
      )
    ).rows[0].id;

    // Two fresh, eligible households — no queue, so cap = capacity = 1, each wants
    // exactly one hull → passes gate 7 (this is what used to fail as OVER_CAP when
    // the race ran on a real, queued East).
    const a = await seedHousehold(db, 'RacerA', [{}]);
    const b = await seedHousehold(db, 'RacerB', [{}]);

    const first = await checkIn(db, lake, a.hh, a.members[0], a.hullIds);
    expect(first).toBeTruthy();
    // The second (the "loser" in the real concurrent race) must be LAKE_FULL, not
    // OVER_CAP or anything else.
    await expectCode(checkIn(db, lake, b.hh, b.members[0], b.hullIds), 'LAKE_FULL');
  });
});
