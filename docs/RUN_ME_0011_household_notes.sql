-- 0011_household_notes — Emerald Bay: free-form board notes on a household, and a
-- reason recorded when the board suspends one directly (independent of a violation).
-- The rules are guidelines the board may depart from by severity — so the reason for
-- a departure has to be recordable.
alter table households add column if not exists notes text;
alter table households add column if not exists suspended_reason text;
