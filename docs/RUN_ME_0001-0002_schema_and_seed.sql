-- RUN_ME_0001-0002 — Emerald Bay schema + seed (BUILD SPEC §11 step 1).
-- Apply to the hosted Supabase project (ref: heybszfdbvavedjkgggb) via
-- Dashboard → SQL Editor → paste this whole file → Run.
--
-- This is the concatenation of, and byte-for-byte equivalent to:
--     supabase/migrations/0001_initial_schema.sql
--     supabase/migrations/0002_seed_lakes_and_config.sql
-- Run it once. 0002 is idempotent (re-runnable); 0001 is not (plain CREATE TABLE).
-- If you use the Supabase CLI instead: `supabase db push` applies the migration
-- files directly and you can ignore this bundle.
-- =============================================================================

-- ===== 0001_initial_schema.sql ==============================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

create table households (
  id              uuid primary key default gen_random_uuid(),
  zoho_record_id  text unique,
  name            text not null,
  address         text,
  status          text not null default 'active'
                    check (status in ('active','suspended')),
  suspended_until timestamptz,
  created_at      timestamptz not null default now()
);

create table members (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references households(id) on delete cascade,
  first_name         text not null,
  last_name          text not null,
  email              text,
  mobile             text,
  role               text not null default 'member'
                       check (role in ('primary','member')),
  is_admin           boolean not null default false,
  birth_year         int,
  boater_ed_attested boolean not null default false,
  supervision_only   boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint members_contact_present check (email is not null or mobile is not null)
);
create index members_household_idx on members (household_id);

create table watercraft (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  sticker_number int not null unique check (sticker_number between 100 and 350),
  craft_type     text not null
                   check (craft_type in
                     ('Pontoon','Jet Ski','Ski/Surf boat','Fishing boat',
                      'Sail boat','E-Foil','Other')),
  is_checkinable boolean not null,
  manufacturer   text,
  model          text,
  year           int,
  length_ft      numeric,
  hull_id        text,
  photo_url      text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  constraint watercraft_checkinable_types check (
    is_checkinable = false
    or craft_type in ('Pontoon','Jet Ski','Ski/Surf boat','Fishing boat')
  )
);
create index watercraft_household_idx on watercraft (household_id);

create table lakes (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique check (name in ('East','West')),
  capacity int not null check (capacity > 0)
);

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  lake_id       uuid not null references lakes(id),
  household_id  uuid not null references households(id),
  started_by    uuid not null references members(id),
  started_at    timestamptz not null default now(),
  hard_end_at   timestamptz,
  ended_at      timestamptz,
  ended_reason  text check (ended_reason in ('user','auto_expire','admin','clamp')),
  last_call     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index sessions_open_by_lake_idx  on sessions (lake_id)      where ended_at is null;
create index sessions_open_by_hh_idx    on sessions (household_id) where ended_at is null;
create index sessions_sweep_idx         on sessions (hard_end_at)  where ended_at is null;

create table session_watercraft (
  session_id        uuid not null references sessions(id) on delete cascade,
  watercraft_id     uuid not null references watercraft(id),
  is_guest_operated boolean not null default false,
  guest_name        text,
  primary key (session_id, watercraft_id)
);
create index session_watercraft_hull_idx on session_watercraft (watercraft_id);

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
create index queue_active_idx on queue_entries (lake_id, joined_at)
  where status in ('waiting','offered');
create unique index queue_one_active_per_hh_idx on queue_entries (lake_id, household_id)
  where status in ('waiting','offered');

create table cooldowns (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id),
  expires_at        timestamptz not null,
  source_session_id uuid references sessions(id)
);
create index cooldowns_active_idx on cooldowns (household_id, expires_at);

create table violations (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id),
  track           text not null check (track in ('app_usage','music','other')),
  kind            text not null,
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

create table violation_schedule (
  id              uuid primary key default gen_random_uuid(),
  track           text not null check (track in ('app_usage','music','other')),
  offense_number  int  not null check (offense_number >= 1),
  fine_amount     numeric,
  suspension_days int,
  note            text,
  unique (track, offense_number)
);

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

-- ===== 0002_seed_lakes_and_config.sql =======================================

insert into lakes (name, capacity) values
  ('East', 4),
  ('West', 3)
on conflict (name) do update set capacity = excluded.capacity;

insert into violation_schedule (track, offense_number, fine_amount, suspension_days, note) values
  ('app_usage', 1, null, 0,  'Warning / notice'),
  ('app_usage', 2, 100,  0,  '$100'),
  ('app_usage', 3, 250,  15, '$250 + 15-day suspension'),
  ('app_usage', 4, 300,  30, '$300 + 30-day suspension')
on conflict (track, offense_number)
  do update set fine_amount     = excluded.fine_amount,
                suspension_days = excluded.suspension_days,
                note            = excluded.note;

insert into violation_schedule (track, offense_number, fine_amount, suspension_days, note) values
  ('music', 1, null, null,
   'Suspension on first occurrence (doc). Board must set the duration — the rules doc gives no number.')
on conflict (track, offense_number)
  do update set note = excluded.note;
