/**
 * REAL concurrency test for the lake row lock (BUILD SPEC §4) — the one gate PGlite
 * (single-connection) can't verify. It opens TWO real Postgres connections and races
 * them for the LAST open slot, many rounds. If the `SELECT … FOR UPDATE` on the lake
 * row holds, exactly one wins each round and the other gets LAKE_FULL.
 *
 * WHY AN ISOLATED TEST LAKE: racing on East depends on East's live state, and a real
 * lake often has open sessions and a queue (which clamps the fair-share cap and makes
 * setup fail with OVER_CAP before the race even starts). So this creates its OWN
 * capacity-1 lake, 'ZZ_LOCKTEST_LAKE', where the ONLY thing preventing a double
 * check-in is the lock. On a capacity-1 lake two racers each want one hull, so no
 * clamp, no filler, no dependence on East/West or your test data.
 *
 * The lakes table has a `name in ('East','West')` CHECK, so the test temporarily
 * drops that ONE constraint (found + restored by name/def, `capacity>0` untouched)
 * and re-adds it in `finally`. Everything it creates is deleted in `finally` too.
 *
 * CONNECTION: use the SESSION pooler (port 5432) or a direct connection — NOT the
 * transaction pooler (6543), which multiplexes onto shared backends and would break
 * the lock semantics. URL-encode the password.
 *
 * RUN:
 *   DATABASE_URL='postgresql://postgres.<ref>:<pw>@aws-...pooler.supabase.com:5432/postgres' \
 *     npm run test:lock
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const ROUNDS = Number(process.env.LOCK_TEST_ROUNDS ?? 12);

// Far-future test day so we never touch today's real sun_times. 18:00Z = 13:00 CDT.
const TEST_CIVIL = '2999-07-01';
const TEST_NOW = '2999-07-01T18:00:00Z';
const TEST_SUNRISE = '2999-07-01T11:00:00Z';
const TEST_SUNSET = '2999-07-02T02:00:00Z';
const TAG = 'ZZ_LOCKTEST_';
const LAKE_NAME = 'ZZ_LOCKTEST_LAKE';

function newClient() {
  return new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function log(msg: string) {
  console.log(msg);
}

async function main() {
  if (!DATABASE_URL) {
    console.error('Set DATABASE_URL (Supabase SESSION pooler / direct, port 5432). See file header.');
    process.exit(2);
  }

  const admin = newClient();
  const r1 = newClient();
  const r2 = newClient();
  await Promise.all([admin.connect(), r1.connect(), r2.connect()]);
  log('connected: 1 admin + 2 racer connections');

  const created = { households: [] as string[], lakeId: null as string | null };
  let droppedConstraint: { name: string; def: string } | null = null;

  try {
    // ── sun_times for the test day ───────────────────────────────────────────
    await admin.query(
      `insert into sun_times (civil_date, sunrise, sunset) values ($1,$2,$3)
       on conflict (civil_date) do update set sunrise=excluded.sunrise, sunset=excluded.sunset`,
      [TEST_CIVIL, TEST_SUNRISE, TEST_SUNSET],
    );
    log('setup: sun_times ready');

    // Purge stale test data from any prior crashed run (households cascade their
    // members + hulls; sessions first so session_watercraft FKs don't block).
    await admin.query(
      `delete from sessions where household_id in (select id from households where name like $1)`,
      [TAG + '%'],
    );
    await admin.query(`delete from households where name like $1`, [TAG + '%']);

    // ── isolated capacity-1 test lake (drop the name CHECK if it blocks us) ───
    // remove any stale test lake from a prior crashed run first
    await admin.query(
      `delete from sessions where lake_id in (select id from lakes where name=$1)`,
      [LAKE_NAME],
    );
    await admin.query(`delete from lakes where name=$1`, [LAKE_NAME]);
    try {
      const r = await admin.query(
        `insert into lakes (name, capacity) values ($1, 1) returning id`,
        [LAKE_NAME],
      );
      created.lakeId = r.rows[0].id;
    } catch {
      // The name CHECK blocked it. Find that one constraint (not capacity>0), drop it.
      const cons = await admin.query(
        `select con.conname as name, pg_get_constraintdef(con.oid) as def
           from pg_constraint con join pg_class rel on rel.oid=con.conrelid
          where rel.relname='lakes' and con.contype='c'`,
      );
      const nameCheck = cons.rows.find((c: { def: string }) => /name/i.test(c.def) && /East/.test(c.def));
      if (!nameCheck) throw new Error('could not identify the lake name CHECK to drop');
      await admin.query(`alter table lakes drop constraint "${nameCheck.name}"`);
      droppedConstraint = { name: nameCheck.name, def: nameCheck.def };
      log(`setup: temporarily dropped lakes constraint ${nameCheck.name} (restored at end)`);
      const r = await admin.query(
        `insert into lakes (name, capacity) values ($1, 1) returning id`,
        [LAKE_NAME],
      );
      created.lakeId = r.rows[0].id;
    }
    const lakeId = created.lakeId!;
    log(`setup: isolated test lake '${LAKE_NAME}' (capacity 1) created`);

    // ── two racer households, one Pontoon each, on free stickers ──────────────
    const used = new Set(
      (await admin.query('select sticker_number from watercraft')).rows.map((r) => r.sticker_number),
    );
    const free: number[] = [];
    for (let s = 100; s <= 350 && free.length < 2; s++) if (!used.has(s)) free.push(s);
    if (free.length < 2) throw new Error('not enough free sticker numbers for the test');

    async function makeRacer(name: string, sticker: number) {
      const hh = (
        await admin.query('insert into households (name) values ($1) returning id', [TAG + name])
      ).rows[0].id;
      created.households.push(hh);
      const member = (
        await admin.query(
          "insert into members (household_id, first_name, last_name, email) values ($1,'T','T',$2) returning id",
          [hh, `${TAG}${name}@example.invalid`],
        )
      ).rows[0].id;
      const hull = (
        await admin.query(
          'insert into watercraft (household_id, sticker_number, craft_type, is_checkinable) values ($1,$2,$3,true) returning id',
          [hh, sticker, 'Pontoon'],
        )
      ).rows[0].id;
      return { hh, member, hull };
    }
    const racerA = await makeRacer('RacerA', free[0]);
    const racerB = await makeRacer('RacerB', free[1]);
    log('setup: two eligible racer households created');

    const call = (c: Client, r: { hh: string; member: string; hull: string }) =>
      c.query('select check_in($1,$2,$3,$4::jsonb,$5::timestamptz) as id', [
        lakeId,
        r.hh,
        r.member,
        JSON.stringify([{ watercraft_id: r.hull }]),
        TEST_NOW,
      ]);

    async function openCount(): Promise<number> {
      return (
        await admin.query(
          `select count(*)::int n from session_watercraft sw
             join sessions s on s.id=sw.session_id
            where s.lake_id=$1 and s.ended_at is null`,
          [lakeId],
        )
      ).rows[0].n;
    }

    let clean = 0;
    let doubleWins = 0;
    log(`\nracing ${ROUNDS} rounds for the single slot on '${LAKE_NAME}'…`);

    for (let round = 1; round <= ROUNDS; round++) {
      // Reset the lake to empty (end any prior-round session; no queue here).
      await admin.query(
        `update sessions set ended_at=$1, ended_reason='admin' where lake_id=$2 and ended_at is null`,
        [TEST_NOW, lakeId],
      );
      await admin.query('delete from cooldowns where household_id = any($1)', [created.households]);
      const before = await openCount();
      if (before !== 0) {
        console.error(`  round ${round}: setup error — lake not empty (${before}); skipping`);
        continue;
      }

      // Fire both check-ins on separate connections, simultaneously.
      const [a, b] = await Promise.allSettled([call(r1, racerA), call(r2, racerB)]);
      const aWon = a.status === 'fulfilled';
      const bWon = b.status === 'fulfilled';
      const after = await openCount();
      const reason = (res: PromiseSettledResult<unknown>) =>
        res.status === 'rejected' ? (res.reason as Error).message.replace(/\s+/g, ' ').trim() : 'won';

      if (aWon && bWon) {
        doubleWins++;
        console.error(`  round ${round}: ❌ BOTH won — lake at ${after}/1 (DOUBLE BOOKING)`);
      } else if (!aWon && !bWon) {
        console.error(`  round ${round}: ⚠ neither won — A:[${reason(a)}] B:[${reason(b)}]`);
      } else {
        const ok = after === 1 && /LAKE_FULL/.test(aWon ? reason(b) : reason(a));
        clean++;
        log(
          `  round ${round}: ${ok ? '✅' : '❓'} ${aWon ? 'A' : 'B'} won, ${aWon ? 'B' : 'A'} refused [${aWon ? reason(b) : reason(a)}]; lake ${after}/1`,
        );
      }
    }

    log(`\n${ROUNDS} rounds: ${clean} clean (one-won-one-refused), ${doubleWins} double-bookings.`);
    if (doubleWins > 0) {
      console.error('LOCK FAILED — the lake was double-booked. Do NOT ship.');
      process.exitCode = 1;
    } else if (clean === ROUNDS) {
      log('LOCK HOLDS — exactly one check-in won every round. ✅');
    } else {
      console.error('INCONCLUSIVE — some rounds did not produce a clean win/refuse. See above.');
      process.exitCode = 1;
    }
  } finally {
    // Delete everything the test created, FK-safe, then restore the constraint.
    const ids = created.households;
    if (ids.length) {
      await admin.query('delete from cooldowns where household_id = any($1)', [ids]).catch(() => {});
      await admin.query('delete from queue_entries where household_id = any($1)', [ids]).catch(() => {});
      await admin.query('delete from sessions where household_id = any($1)', [ids]).catch(() => {});
      await admin.query('delete from households where id = any($1)', [ids]).catch(() => {}); // cascades members + hulls
    }
    if (created.lakeId) {
      await admin.query('delete from sessions where lake_id=$1', [created.lakeId]).catch(() => {});
      await admin.query('delete from lakes where id=$1', [created.lakeId]).catch(() => {});
    }
    if (droppedConstraint) {
      await admin
        .query(`alter table lakes add constraint "${droppedConstraint.name}" ${droppedConstraint.def}`)
        .then(() => log('cleanup: restored lakes name constraint'))
        .catch((e) => console.error('cleanup: FAILED to restore lakes constraint —', e.message));
    }
    await admin.query('delete from sun_times where civil_date=$1', [TEST_CIVIL]).catch(() => {});
    await Promise.all([admin.end(), r1.end(), r2.end()]);
    log('cleanup: test rows removed, connections closed');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
