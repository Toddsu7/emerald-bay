# Emerald Bay — build handoff

Everything in the BUILD SPEC's build order (§11 steps 1–10) is implemented,
type-checked, `next build`-green, and covered by **48 passing tests** (pure logic +
a real-Postgres engine suite run in PGlite). This branch (`build/v1`) is a PR into
`main`; **`main` is untouched so Vercel hasn't deployed a half-built state.** Merge
when you're ready to ship.

What can't run until you supply something is listed under **"Do this"** below. None
of it is a code gap — it's data, secrets, and the hosted DB.

---

## What's built & verified

| Spec | Built | Verified |
|---|---|---|
| §11.1 Schema + seed (lakes, violation schedule) | ✅ | migrations run in PGlite |
| §4 Check-in transaction (lake row lock, gates 1–7) | ✅ | 8 gate tests + happy path |
| §2.6 Fair-share clamp | ✅ | unit + engine test |
| §2.4/§2.5 Session length, cooldown, **exploit fix** | ✅ | engine test (household cooldown blocks re-checkin *and* queue) |
| §2.2 Sunset-relative hours (Wichita) | ✅ | unit tests (jet-ski vs boat windows, DST) |
| §2.7/§5 Queue, offers, sweep | ✅ | offer→LAUNCH lifecycle test |
| §3/§7 Auth (magic link), RLS, roster reads | ✅ | build |
| §6 Public board | ✅ | build |
| §8 Photo upload | ✅ | build |
| §9 Notifications (SMS out/in, push) | ✅ (dormant) | build |
| §10 Import, admin (violations/override/schedule) | ✅ | import self-validates; build |

**The one thing I could not verify locally:** the lake row lock's behaviour under
two *simultaneous* connections. PGlite is single-connection, so the gate logic and
all state transitions are proven, but true concurrent serialization needs the hosted
DB. See **"Verify the lock"** below — it's a 2-minute check.

---

## Do this (in order)

### 1. Apply the SQL to hosted Supabase
Dashboard → SQL Editor → paste and run **in numeric order**:
`docs/RUN_ME_0001-0002…`, then `0003`, `0004`, `0005`, `0006`. (Or, with the
Supabase CLI linked: `supabase db push`.)

### 2. Set environment variables
In Vercel (Production + Preview) **and** local `.env.local` — see `.env.example`:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://heybszfdbvavedjkgggb.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Dashboard → API)
- `NEXT_PUBLIC_SITE_URL` = your deployed URL (used in magic-link + SMS links; **must
  match** the Twilio webhook URL for signature validation)
- `CRON_SECRET` = any long random string

### 3. Configure Supabase Auth (magic link, §7)
Dashboard → Authentication:
- Email provider **on**; **disable sign-ups** (only imported members may log in).
- Redirect URLs: add `${SITE_URL}/auth/callback` (and the localhost one for dev).
- Set the Site URL to `${SITE_URL}`.

### 4. Import the roster (§10)
1. Put the two Zoho export CSVs in `./data/` (git-ignored).
2. **Verify the column mapping** at the top of `scripts/import.ts` against your real
   headers — the spec's quirks are encoded (hull-1 has no suffix, the `Manufacture\xa0 2`
   nbsp, etc.) but sticker/status/manufacturer header names are best-guess.
3. `npm run import -- --dry-run` → it parses, prints the household/hull counts and
   craft mix, and **fails loudly** if stickers dupe or fall outside 100–350 or a
   household lacks an email. Expect **187 households / 196 hulls**.
4. `npm run import` to apply. Re-runnable (idempotent upserts).

### 5. Make the 7 board members admins
```sql
update members set is_admin = true where email in ('…','…');  -- the board of 7
```

### 6. Wire the every-minute sweep (§5)
Vercel Cron's free tier is once/day — not enough. On **cron-job.org**, create a job
hitting `GET ${SITE_URL}/api/cron/sweep` **every minute**, with either header
`Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`. It ends expired
sessions, flags no-checkout violations, expires stale offers, promotes the queue,
recomputes caps, and sends offer notifications.

### 7. Notifications, when you're ready (§9) — currently dormant
- **Twilio:** set `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER`. Point the number's
  Messaging webhook (A message comes in) to `POST ${SITE_URL}/api/sms/inbound`.
- **Web push:** `npx web-push generate-vapid-keys`, set
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT`. (Server send + the
  subscribe endpoint are ready; the browser service-worker + subscribe button is the
  one push piece not yet built — see limitations.)

### Verify the lock (2 min, once hosted)
From two terminals (or `psql`) fire two `select check_in(<same lake>, …)` calls that
would exceed capacity at the same instant. Exactly one must win; the other must get
`LAKE_FULL`/`OVER_CAP`. This confirms the `FOR UPDATE` serialization that PGlite
couldn't exercise.

---

## Open decisions for the board (surface these — do not let code decide)

1. **Violation schedule: dollars vs suspension-only (§2.8/§12.1).** The rules doc
   says app-usage is warning → 15-day suspension → escalating with **no dollar
   amounts**; your schedule has dollars. Both shipped: the config table is preloaded
   with your numbers and editable at `/admin`. Board picks; no deploy needed.
2. **Registration form says operators 12–16; Kansas law says 12–20 (§7).** Built to
   **12–20** regardless. The 2024 form needs updating.
3. **Music/profanity suspension length (§2.8).** The doc says "suspension on first
   occurrence" but gives **no duration**. The schedule row exists with
   `suspension_days = NULL` as the "board must set" signal — set it at `/admin`.
4. **35 households have no mobile (§7).** They get no SMS until they add one. Nag at
   first login is noted but the member-profile UI to capture it isn't built yet.
5. **No hull photos exist yet (§10).** The board is much weaker without them. Members
   upload at `/hulls`; prompt hard.
6. **Clamp semantics (my interpretation — confirm).** Per §2.4 literally, once a queue
   exists **every** open session on that lake gets a hard end = `max(now+10m,
   start+60m)`; the §2.6 clamp additionally flags `last_call` on over-cap households
   and blocks their re-entry beyond cap. Nobody is kicked mid-session. A hard end,
   once set, is **not** lifted if the queue later drains. If the board wants the clamp
   to shed exactly one boat rather than hard-ending all, that's a change to
   `_recompute` in `0003`.
7. **SMS `LAUNCH` for multi-hull households (§9).** SMS can't carry hull selection, so
   `LAUNCH` auto-starts only when the household has exactly one available hull;
   otherwise it replies with the app link. Confirm that's the desired behaviour.

---

## Not yet built (honest gaps, none blocking the core)

- **Additional-member registration / invite UI.** Import seeds each household + its
  primary contact; login links a member row by matching email. The flow to *add* new
  members (kids/spouse) with name + age + boater-ed attestation isn't built. Schema
  supports it (`members.birth_year/boater_ed_attested/supervision_only`).
- **Age-gate enforcement (§7).** It's a registration-time attestation, not a check-in
  gate (check-in is household-level and doesn't record which member operates which
  hull). Needs the member-registration UI above.
- **Web-push client.** Service worker + subscribe button. Server send + storage are
  ready; SMS is the primary ramp channel meanwhile.
- **PWA icons.** `app/manifest.ts` has no icons yet — add 192/512 PNGs under
  `/public` and reference them.
- **Board auto-refresh.** The board revalidates on navigation and after actions;
  a live poll/realtime subscription would make it self-updating on shore.

## Where things live
- Engine (the spine): `supabase/migrations/0003_checkin_engine.sql`
- Pure rules + tests: `lib/{caps,hours,sun,session}.ts` (+ `.test.ts`)
- Engine integration test: `tests/engine.test.ts`
- Server actions: `lib/actions/{checkin,queue,admin,photos}.ts`
- Screens: `app/{board,checkin,hulls,admin,login}/`
