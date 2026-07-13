-- 0002_seed_lakes_and_config — Emerald Bay (BUILD SPEC v1 §2.1, §2.8):
--   the two monitored lakes + the board-editable violation schedule.
-- Idempotent: safe to re-run (upserts on natural keys).

-- ── Lakes (§2.1). The third, no-wake lake is out of scope and is NOT seeded. ──
insert into lakes (name, capacity) values
  ('East', 4),   -- main
  ('West', 3)
on conflict (name) do update set capacity = excluded.capacity;

-- ── Violation schedule (§2.8) ────────────────────────────────────────────────
-- Track A — app usage (failure to check in while making a wake; failure to
-- check out). Todd's DOLLAR schedule, preloaded. The board may overwrite any row
-- from the admin UI (§11.10) with no deploy.
--
--   ⚠ CONFLICT for the board (§12.1): the rules doc states this track as
--     warning → 15-day suspension → escalating, with NO dollar amounts. Todd's
--     schedule (below) has dollar amounts. They do not match. This is a board
--     decision — shipped as config either way; NOT resolved in code.
--   Escalatable by the board up to a 1-year suspension (runtime board action,
--   not a schedule row).
insert into violation_schedule (track, offense_number, fine_amount, suspension_days, note) values
  ('app_usage', 1, null, 0,  'Warning / notice'),
  ('app_usage', 2, 100,  0,  '$100'),
  ('app_usage', 3, 250,  15, '$250 + 15-day suspension'),
  ('app_usage', 4, 300,  30, '$300 + 30-day suspension')
on conflict (track, offense_number)
  do update set fine_amount     = excluded.fine_amount,
                suspension_days = excluded.suspension_days,
                note            = excluded.note;

-- Track B — music / profanity. Own counter, own schedule (must NOT share a
-- counter with app_usage, §2.8). The doc says "suspension on first occurrence"
-- but gives NO duration. We seed the row so it exists, with suspension_days = NULL
-- as the explicit "board must set a duration" signal (a null here means the app
-- treats the music consequence as unconfigured — never auto-anything, §13). This
-- is board open-item, surfaced in the handoff.
insert into violation_schedule (track, offense_number, fine_amount, suspension_days, note) values
  ('music', 1, null, null,
   'Suspension on first occurrence (doc). Board must set the duration — the rules doc gives no number.')
on conflict (track, offense_number)
  do update set note = excluded.note;
