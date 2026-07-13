-- 0001_initial_schema — Emerald Bay Lake App (BUILD SPEC v1 §3): core tables.
--
-- Design notes (see BUILD SPEC §13 Invariants):
--   * The session UNIT is the HOUSEHOLD, never the person. Every cap, cooldown,
--     suspension and violation is household-scoped. This is what kills the
--     double-clock-in exploit (§2.5).
--   * craft_type mirrors the 7-value Zoho picklist. Only 5 are in use today; the
--     other two (Sail boat, Other) are DELIBERATELY retained — a household could
--     register a sail boat next year. Do not prune the enum. (spec §10 vs §3 is
--     not a conflict: the picklist offers 7, the data uses 5.)
--   * E-Foils are registered (the household owns them) but are NOT checkinable and
--     never consume a slot. Enforced here by a CHECK constraint so no import bug can
--     ever flip an E-Foil (or Sail boat / Other) to checkinable.
--   * RLS is ENABLED on every table but policies are intentionally deferred to the
--     auth step (§11.3). The import (§11.2) runs under the service-role key, which
--     bypasses RLS, so it is unaffected. Until policies land, the anon/authenticated
--     client can read nothing — secure by default.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- households — THE unit of everything
-- ─────────────────────────────────────────────────────────────────────────────
create table households (
  id              uuid primary key default gen_random_uuid(),
  zoho_record_id  text unique,                       -- provenance back to Zoho
  name            text not null,                      -- "Todd Sutcliffe"
  address         text,
  status          text not null default 'active'
                    check (status in ('active','suspended')),
  suspended_until timestamptz,                        -- enforced at the same gate as cooldown
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- members — people. Have logins; ride the household's hulls; count against the
--           household cap. NOT the session unit.
-- ─────────────────────────────────────────────────────────────────────────────
create table members (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references households(id) on delete cascade,
  first_name         text not null,                   -- valid first AND last name required (§7)
  last_name          text not null,
  email              text,
  mobile             text,                            -- only 152/187 have one (§7); nag at login
  role               text not null default 'member'
                       check (role in ('primary','member')),
  is_admin           boolean not null default false,  -- the board of 7 (§7)
  birth_year         int,
  boater_ed_attested boolean not null default false,  -- 12–20 age gate (§7, Kansas law)
  supervision_only   boolean not null default false,
  created_at         timestamptz not null default now(),
  -- doc requires at least one contact channel for magic-link auth:
  constraint members_contact_present check (email is not null or mobile is not null)
);
create index members_household_idx on members (household_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- watercraft — sticker_number is THE identity key (the enforcement hero, §6)
-- ─────────────────────────────────────────────────────────────────────────────
create table watercraft (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  sticker_number int not null unique check (sticker_number between 100 and 350),
  craft_type     text not null
                   check (craft_type in
                     ('Pontoon','Jet Ski','Ski/Surf boat','Fishing boat',
                      'Sail boat','E-Foil','Other')),
  is_checkinable boolean not null,                    -- set by import from craft_type
  manufacturer   text,
  model          text,
  year           int,
  length_ft      numeric,
  hull_id        text,
  photo_url      text,                                -- uploaded at first login (§10)
  active         boolean not null default true,       -- 'Registering for 2026'
  created_at     timestamptz not null default now(),
  -- Invariant guard: only the four powered wake-making types may ever be checkinable.
  -- E-Foil / Sail boat / Other can NEVER be checkinable, no matter what import writes.
  constraint watercraft_checkinable_types check (
    is_checkinable = false
    or craft_type in ('Pontoon','Jet Ski','Ski/Surf boat','Fishing boat')
  )
);
create index watercraft_household_idx on watercraft (household_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- lakes — exactly two rows. The lake row is the lock target (§4).
-- ─────────────────────────────────────────────────────────────────────────────
create table lakes (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique check (name in ('East','West')),
  capacity int not null check (capacity > 0)          -- East 4, West 3
);

-- ─────────────────────────────────────────────────────────────────────────────
-- sessions — an ACTIVE session holds N hulls for one household on one lake
-- ─────────────────────────────────────────────────────────────────────────────
create table sessions (
  id            uuid primary key default gen_random_uuid(),
  lake_id       uuid not null references lakes(id),
  household_id  uuid not null references households(id),   -- THE unit, not member
  started_by    uuid not null references members(id),      -- who tapped the button
  started_at    timestamptz not null default now(),
  hard_end_at   timestamptz,                               -- set when a queue forms
  ended_at      timestamptz,
  ended_reason  text check (ended_reason in ('user','auto_expire','admin','clamp')),
  last_call     boolean not null default false,
  created_at    timestamptz not null default now()
);
-- Hot paths (§4 recount / §5 sweep): all scoped to OPEN sessions.
create index sessions_open_by_lake_idx  on sessions (lake_id)      where ended_at is null;
create index sessions_open_by_hh_idx    on sessions (household_id) where ended_at is null;
create index sessions_sweep_idx         on sessions (hard_end_at)  where ended_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- session_watercraft — a session holds N hulls; guest-operated hulls flagged
-- ─────────────────────────────────────────────────────────────────────────────
create table session_watercraft (
  session_id        uuid not null references sessions(id) on delete cascade,
  watercraft_id     uuid not null references watercraft(id),
  is_guest_operated boolean not null default false,
  guest_name        text,
  primary key (session_id, watercraft_id)
);
-- Gate 4 ("no selected hull already in an open session", §4) is enforced in the
-- check-in function, which joins through here; this index makes that lookup cheap.
create index session_watercraft_hull_idx on session_watercraft (watercraft_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- queue_entries — separate queue per lake, no cross-lake offers (§2.7)
-- ─────────────────────────────────────────────────────────────────────────────
create table queue_entries (
  id               uuid primary key default gen_random_uuid(),
  lake_id          uuid not null references lakes(id),
  household_id     uuid not null references households(id),
  requested_by     uuid not null references members(id),
  joined_at        timestamptz not null default now(),
  offered_at       timestamptz,
  offer_expires_at timestamptz,
  pass_count       int not null default 0,
  status           text not null default 'waiting'
                     check (status in ('waiting','offered','launched','passed','cancelled'))
);
-- FIFO scan for the next household to offer, per lake:
create index queue_active_idx on queue_entries (lake_id, joined_at)
  where status in ('waiting','offered');
-- A household may hold at most ONE active queue entry per lake (joining twice would
-- game the fair-share denominator). Enforced at the DB level:
create unique index queue_one_active_per_hh_idx on queue_entries (lake_id, household_id)
  where status in ('waiting','offered');

-- ─────────────────────────────────────────────────────────────────────────────
-- cooldowns — 60-min HOUSEHOLD lock after a queued-out session ends (§2.4/§2.5)
-- ─────────────────────────────────────────────────────────────────────────────
create table cooldowns (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id),
  expires_at        timestamptz not null,
  source_session_id uuid references sessions(id)
);
-- The exploit-fix gate ("household not in cooldown", §4) probes this by household:
create index cooldowns_active_idx on cooldowns (household_id, expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- violations — auto-FLAGGED, human-confirmed. Never auto-fine (§2.8, §13).
--   Two independent tracks (app_usage, music); they must NOT share a counter.
-- ─────────────────────────────────────────────────────────────────────────────
create table violations (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id),
  track           text not null check (track in ('app_usage','music','other')),
  kind            text not null,                        -- 'no_checkout'|'no_checkin'|'out_of_hours'|...
  detected_at     timestamptz not null default now(),
  session_id      uuid references sessions(id),
  status          text not null default 'flagged'
                    check (status in ('flagged','confirmed','dismissed')),
  reviewed_by     uuid references members(id),
  fine_amount     numeric,
  suspension_days int,
  notes           text
);
create index violations_household_idx on violations (household_id, track, detected_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- violation_schedule — CONFIG. Board-editable, no deploy needed to change fines.
--   Seeded in 0002 with Todd's dollar schedule. The schedule ⇄ doc conflict
--   (§2.8, §12.1) is a BOARD decision, not an engineering one: we ship both the
--   config table and Todd's numbers; the board can overwrite. Do not resolve it
--   in code.
-- ─────────────────────────────────────────────────────────────────────────────
create table violation_schedule (
  id              uuid primary key default gen_random_uuid(),
  track           text not null check (track in ('app_usage','music','other')),
  offense_number  int  not null check (offense_number >= 1),
  fine_amount     numeric,        -- null = no fine at this step
  suspension_days int,            -- null = board must set a duration; 0 = explicitly none
  note            text,
  unique (track, offense_number)
);

-- RLS on. Policies land with auth (§11.3). Service-role import bypasses RLS.
alter table households         enable row level security;
alter table members            enable row level security;
alter table watercraft         enable row level security;
alter table lakes              enable row level security;
alter table sessions           enable row level security;
alter table session_watercraft enable row level security;
alter table queue_entries      enable row level security;
alter table cooldowns          enable row level security;
alter table violations         enable row level security;
alter table violation_schedule enable row level security;
