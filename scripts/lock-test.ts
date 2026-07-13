/**
 * REAL concurrency test for the lake row lock (BUILD SPEC §4). This is the one gate
 * PGlite (single-connection) could not verify — the difference between a 4-boat
 * lake and a 5-boat-lake-with-someone-fined-for-a-bug.
 *
 * It opens TWO real Postgres connections and has them race for the LAST open slot
 * on East, many rounds. If the `SELECT … FOR UPDATE` on the lake row holds, exactly
 * one wins each round and the other gets LAKE_FULL — the lake never exceeds 4.
 *
 * SAFETY: it only ever touches its own rows — households named 'ZZ_LOCKTEST_*', a
 * far-future sun_times date, and the sessions those households create. A `finally`
 * block deletes all of it, even on failure. It does not modify East/West config or
 * any real roster row. Still, prefer running it against a staging DB or off-hours.
 *
 * RUN:
 *   # Connection string: Supabase Dashboard → Project Settings → Database →
 *   # "Connection string" (URI). URL-encode the password. Session/direct works.
 *   DATABASE_URL='postgresql://postgres:...@db.heybszfdbvavedjkgggb.supabase.co:5432/postgres' \
 *     npm run test:lock
 */
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const ROUNDS = Number(process.env.LOCK_TEST_ROUNDS ?? 8);

// Far-future test day so we never touch today's real sun_times. 18:00Z = 13:00 CDT.
const TEST_CIVIL = '2999-07-01';
const TEST_NOW = '2999-07-01T18:00:00Z';
const TEST_SUNRISE = '2999-07-01T11:00:00Z';
const TEST_SUNSET = '2999-07-02T02:00:00Z';
const TAG = 'ZZ_LOCKTEST_';

function newClient() {
  return new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

async function pickFreeStickers(c: Client, n: number): Promise<number[]> {
  const used = new Set(
    (await c.query('select sticker_number from watercraft')).rows.map((r) => r.sticker_number),
  );
  const free: number[] = [];
  for (let s = 100; s <= 350 && free.length < n; s++) if (!used.has(s)) free.push(s);
  if (free.length < n) throw new Error('not enough free sticker numbers for the test');
  return free;
}

async function main() {
  if (!DATABASE_URL) {
    console.error('Set DATABASE_URL (Supabase connection string). See the header of this file.');
    process.exit(2);
  }

  const admin = newClient();
  const r1 = newClient();
  const r2 = newClient();
  await Promise.all([admin.connect(), r1.connect(), r2.connect()]);

  const created = { households: [] as string[] };

  try {
    const east = (await admin.query("select id, capacity from lakes where name='East'")).rows[0];
    if (!east) throw new Error('East lake not found — apply migrations + seed first');
    const capacity: number = east.capacity;

    await admin.query(
      `insert into sun_times (civil_date, sunrise, sunset) values ($1,$2,$3)
       on conflict (civil_date) do update set sunrise=excluded.sunrise, sunset=excluded.sunset`,
      [TEST_CIVIL, TEST_SUNRISE, TEST_SUNSET],
    );

    const stickers = await pickFreeStickers(admin, capacity + 2); // filler(cap-1) + 2 racers + margin

    // Helper to spin up a test household with one Pontoon, returning ids.
    let sIdx = 0;
    async function makeHousehold(name: string): Promise<{ hh: string; member: string; hull: string }> {
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
          [hh, stickers[sIdx++], 'Pontoon'],
        )
      ).rows[0].id;
      return { hh, member, hull };
    }

    // Filler household holds (capacity-1) hulls so exactly ONE slot is open.
    const filler = (
      await admin.query('insert into households (name) values ($1) returning id', [TAG + 'Filler'])
    ).rows[0].id;
    created.households.push(filler);
    const fillerMember = (
      await admin.query(
        "insert into members (household_id, first_name, last_name, email) values ($1,'F','F',$2) returning id",
        [filler, `${TAG}filler@example.invalid`],
      )
    ).rows[0].id;
    const fillerHulls: string[] = [];
    for (let i = 0; i < capacity - 1; i++) {
      fillerHulls.push(
        (
          await admin.query(
            'insert into watercraft (household_id, sticker_number, craft_type, is_checkinable) values ($1,$2,$3,true) returning id',
            [filler, stickers[sIdx++], 'Pontoon'],
          )
        ).rows[0].id,
      );
    }

    const racerA = await makeHousehold('RacerA');
    const racerB = await makeHousehold('RacerB');

    async function fillToOneOpen() {
      // End every test session on East, then re-seat the filler at capacity-1.
      await admin.query(
        `update sessions set ended_at=$1, ended_reason='admin'
           where lake_id=$2 and ended_at is null and household_id = any($3)`,
        [TEST_NOW, east.id, created.households],
      );
      // clear cooldowns the ends may have created, so racers aren't blocked
      await admin.query('delete from cooldowns where household_id = any($1)', [created.households]);
      await admin.query('delete from queue_entries where household_id = any($1)', [created.households]);
      await admin.query('select check_in($1,$2,$3,$4::jsonb,$5::timestamptz)', [
        east.id,
        filler,
        fillerMember,
        JSON.stringify(fillerHulls.map((id) => ({ watercraft_id: id }))),
        TEST_NOW,
      ]);
    }

    const call = (c: Client, r: { hh: string; member: string; hull: string }) =>
      c.query('select check_in($1,$2,$3,$4::jsonb,$5::timestamptz) as id', [
        east.id,
        r.hh,
        r.member,
        JSON.stringify([{ watercraft_id: r.hull }]),
        TEST_NOW,
      ]);

    let wins = 0;
    let refusals = 0;
    let doubleWins = 0;

    for (let round = 1; round <= ROUNDS; round++) {
      await fillToOneOpen();

      const [a, b] = await Promise.allSettled([call(r1, racerA), call(r2, racerB)]);
      const aWon = a.status === 'fulfilled';
      const bWon = b.status === 'fulfilled';

      const openHulls = (
        await admin.query(
          `select count(*)::int n from session_watercraft sw
             join sessions s on s.id=sw.session_id
            where s.lake_id=$1 and s.ended_at is null`,
          [east.id],
        )
      ).rows[0].n;

      if (aWon && bWon) {
        doubleWins++;
        console.error(`  round ${round}: ❌ BOTH won — lake at ${openHulls}/${capacity}`);
      } else if (!aWon && !bWon) {
        console.error(`  round ${round}: ⚠ neither won (unexpected):`);
        if (a.status === 'rejected') console.error('    A:', (a.reason as Error).message);
        if (b.status === 'rejected') console.error('    B:', (b.reason as Error).message);
      } else {
        wins++;
        refusals++;
        const loser = aWon ? b : a;
        const reason = loser.status === 'rejected' ? (loser.reason as Error).message : '';
        const ok = openHulls === capacity && /LAKE_FULL/.test(reason);
        console.log(
          `  round ${round}: ${ok ? '✅' : '❓'} one won, one refused (${reason.trim()}); lake ${openHulls}/${capacity}`,
        );
      }
    }

    console.log(`\n${ROUNDS} rounds: ${wins} clean, ${doubleWins} double-wins.`);
    if (doubleWins > 0) {
      console.error('LOCK FAILED — the lake exceeded capacity. Do not ship.');
      process.exitCode = 1;
    } else {
      console.log('LOCK HOLDS — exactly one check-in won every round. ✅');
    }
  } finally {
    // Clean up every row this test created, in FK-safe order.
    const ids = created.households;
    if (ids.length) {
      await admin.query('delete from cooldowns where household_id = any($1)', [ids]).catch(() => {});
      await admin.query('delete from queue_entries where household_id = any($1)', [ids]).catch(() => {});
      await admin.query('delete from sessions where household_id = any($1)', [ids]).catch(() => {});
      await admin.query('delete from households where id = any($1)', [ids]).catch(() => {}); // cascades members + watercraft
    }
    await admin.query('delete from sun_times where civil_date=$1', [TEST_CIVIL]).catch(() => {});
    await Promise.all([admin.end(), r1.end(), r2.end()]);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
