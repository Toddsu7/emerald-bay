# Emerald Bay Lake App

HOA lake-access gating for the Emerald Bay association (East + West lakes). The app
enforces hard capacity caps, sunset-relative hours, a fair-share queue, and the
household-level cooldown that kills the double-clock-in exploit. It is not a
logbook — **it says no.**

Built to the BUILD SPEC v1. Stack: **Next.js (App Router) · Supabase Postgres ·
Vercel · Twilio SMS · Web Push**, shipped as a PWA.

> **First time here? Read [`docs/HANDOFF.md`](docs/HANDOFF.md)** — it lists every
> manual step (apply SQL, set secrets, import data, wire the cron) and every open
> decision left for the board.

## The core idea

Everything that changes a lake's boat count runs inside **one Postgres transaction
that locks the lake row** (`SELECT … FOR UPDATE`). Two people tapping "Check In" in
the same second cannot both get the last slot. The gates, cooldown, fair-share
clamp, and queue all live in that locked path — see
`supabase/migrations/0003_checkin_engine.sql`. The app layer authenticates, resolves
the caller's household, and calls those functions; it never recomputes counts
client-side.

Invariants (do not weaken — BUILD SPEC §13):

- The session unit is the **household**, never the person.
- **Cooldown blocks queueing**, not just check-in.
- Every count-changing op takes the **lake row lock**.
- **Never auto-fine** — auto-flag, a board member confirms.
- **E-Foils are not in the app** (registered, never checkinable).

## Layout

```
supabase/migrations/   0001 schema · 0002 seed · 0003 engine · 0004 auth+RLS
                       0005 notifications · 0006 storage · 0007 member.active
                       0008 hull thumbnail · 0009 continuous-hours timing
docs/RUN_ME_*.sql      paste-into-SQL-editor copies of each migration
lib/                   pure logic (caps, hours, sun, session) + supabase clients,
                       auth, actions, board, notify — 48 unit/integration tests
app/                   /login /board /checkin /hulls /admin + api routes
scripts/import.ts      idempotent Zoho → Supabase importer
```

## Develop

```bash
npm install
cp .env.example .env.local     # fill in Supabase + secrets (see HANDOFF)
npm run dev                    # http://localhost:3000
npm test                       # 48 tests: pure logic + PGlite engine integration
npm run typecheck
npm run build
```

## Tests

- **Pure libs** (`lib/*.test.ts`) — fair-share clamp, sunset-relative hours,
  timezone/astronomy, session/cooldown math.
- **Engine integration** (`tests/engine.test.ts`) — runs the real migration SQL in
  PGlite (WASM Postgres) and exercises every check-in gate, the clamp, the
  household-cooldown exploit fix, and the offer→LAUNCH lifecycle.

## Migrations

Written as `supabase/migrations/00NN_*.sql`, with a byte-identical
`docs/RUN_ME_00NN_*.sql` for the Supabase SQL editor. **Apply in numeric order.**
Todd applies to hosted Supabase (the app does not apply to hosted itself).
