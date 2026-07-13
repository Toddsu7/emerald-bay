-- 0003_checkin_engine — Emerald Bay (BUILD SPEC §4, §5, §2.4, §2.6): the spine.
--
-- Everything that changes a lake's count runs inside ONE transaction that takes a
-- ROW-LEVEL LOCK on the lake row (SELECT ... FOR UPDATE). Two members tapping
-- "Check In" in the same second is not hypothetical (§4) — the lock serializes
-- them so the lake never holds 5 boats.
--
-- Design decisions worth knowing:
--   * Hours (§2.2) are enforced SERVER-SIDE from the sun_times table, never from
--     caller-passed values — a client cannot widen its own legal window. If today's
--     sun_times row is missing, check-in REFUSES (never a false clear, §13).
--   * These functions are SECURITY DEFINER and are granted to service_role ONLY.
--     All calls go through Next server actions that first authenticate the user and
--     resolve their household; the functions are not reachable from the anon client.
--   * Error signalling: gates raise exception with a STABLE CODE as the message
--     (e.g. 'COOLDOWN', 'OVER_CAP'); the server action maps codes → user text.
--
-- Interpretation notes flagged for the board (see handoff):
--   * §2.4 is literal: once a queue exists, EVERY open session on that lake gets a
--     hard end = max(now+10m, start+60m). Clamp (§2.6) additionally flags last_call
--     on over-cap households and blocks their re-entry beyond cap. Nobody is ever
--     kicked off mid-session (hard end is always ≥ now+10m).
--   * A hard end, once set, is not lifted if the queue later drains (a made promise).

-- ─────────────────────────────────────────────────────────────────────────────
-- sun_times — one row per civil date (America/Chicago). sunrise/sunset come from
-- the app (SunCalc); the 10:00 jet-ski floor and the ±30-min offsets are derived
-- in SQL. Populated daily by the sweep/cron; check-in reads it.
-- ─────────────────────────────────────────────────────────────────────────────
create table sun_times (
  civil_date date primary key,
  sunrise    timestamptz not null,
  sunset     timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table sun_times enable row level security;

-- ── helper: current per-household hull cap for a lake (mirrors lib/caps.ts) ────
create or replace function _current_cap(p_lake_id uuid)
returns int language plpgsql stable as $$
declare v_cap int; v_on_water int; v_waiting int;
begin
  select capacity into v_cap from lakes where id = p_lake_id;
  select count(distinct household_id) into v_on_water
    from sessions where lake_id = p_lake_id and ended_at is null;
  select count(distinct household_id) into v_waiting
    from queue_entries where lake_id = p_lake_id and status in ('waiting','offered');
  if v_waiting <= 0 then
    return v_cap;                              -- no queue → up to full capacity
  end if;
  return greatest(1, floor(v_cap::numeric / (v_on_water + v_waiting))::int);
end $$;

-- ── helper: recompute queue rules + clamp for a lake (§2.4, §2.6) ─────────────
create or replace function _recompute(p_lake_id uuid, p_now timestamptz)
returns void language plpgsql as $$
declare v_queue boolean; v_cap int;
begin
  select exists (
    select 1 from queue_entries where lake_id = p_lake_id and status in ('waiting','offered')
  ) into v_queue;

  if v_queue then
    -- §2.4: every open session gets a hard end when a queue exists (don't move one
    -- already set).
    update sessions
       set hard_end_at = greatest(p_now + interval '10 minutes',
                                  started_at + interval '60 minutes')
     where lake_id = p_lake_id and ended_at is null and hard_end_at is null;

    -- §2.6 clamp: flag last_call on households currently over the fair-share cap.
    v_cap := _current_cap(p_lake_id);
    update sessions s set last_call = true
     where s.lake_id = p_lake_id and s.ended_at is null
       and s.household_id in (
         select s2.household_id
           from sessions s2
           join session_watercraft sw on sw.session_id = s2.id
          where s2.lake_id = p_lake_id and s2.ended_at is null
          group by s2.household_id
         having count(*) > v_cap
       );
  else
    -- No queue: sessions run open-ended (§2.4). Clear stale clamp flags.
    update sessions set last_call = false
     where lake_id = p_lake_id and ended_at is null and last_call = true;
  end if;
end $$;

-- ── helper: offer the front waiting household when a slot is open (§2.7) ───────
create or replace function _promote(p_lake_id uuid, p_now timestamptz)
returns void language plpgsql as $$
declare v_capacity int; v_open_hulls int; v_front uuid;
begin
  -- Only one outstanding offer per lake at a time.
  if exists (select 1 from queue_entries where lake_id = p_lake_id and status = 'offered') then
    return;
  end if;
  select capacity into v_capacity from lakes where id = p_lake_id;
  select count(*) into v_open_hulls
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null;
  if v_capacity - v_open_hulls < 1 then
    return;                                     -- no open slot
  end if;
  select id into v_front
    from queue_entries
   where lake_id = p_lake_id and status = 'waiting'
   order by joined_at asc
   limit 1;
  if v_front is null then return; end if;
  update queue_entries
     set status = 'offered', offered_at = p_now,
         offer_expires_at = p_now + interval '10 minutes'
   where id = v_front;
end $$;

-- ── core gate + insert (caller MUST already hold the lake lock) ───────────────
-- Runs §4 gates 1–7 in order, inserts the session + its hulls, and recomputes.
create or replace function _checkin_core(
  p_lake_id      uuid,
  p_household_id uuid,
  p_started_by   uuid,
  p_hulls        jsonb,   -- [{watercraft_id, is_guest_operated, guest_name}]
  p_now          timestamptz
) returns uuid language plpgsql as $$
declare
  v_session_id uuid;
  v_selected   int;
  v_capacity   int;
  v_lake_open  int;
  v_open_hulls int;
  v_cap        int;
  v_civil      date;
  v_sunrise    timestamptz;
  v_sunset     timestamptz;
  v_tenam      timestamptz;
  v_has_jet    boolean;
  v_earliest   timestamptz;
  v_latest     timestamptz;
begin
  select count(*) into v_selected from jsonb_array_elements(p_hulls);
  if v_selected = 0 then raise exception 'NO_HULLS'; end if;

  -- 1. household not suspended
  if exists (
    select 1 from households
     where id = p_household_id
       and (status = 'suspended'
            or (suspended_until is not null and suspended_until > p_now))
  ) then raise exception 'SUSPENDED'; end if;

  -- 2. household not in cooldown  (the exploit fix — also blocks queueing, §2.5)
  if exists (
    select 1 from cooldowns where household_id = p_household_id and expires_at > p_now
  ) then raise exception 'COOLDOWN'; end if;

  -- 3. every selected hull is active, checkinable, and owned by this household
  if exists (
    select 1 from jsonb_array_elements(p_hulls) h
    left join watercraft w on w.id = (h->>'watercraft_id')::uuid
    where w.id is null
       or w.household_id <> p_household_id
       or w.active = false
       or w.is_checkinable = false
  ) then raise exception 'INVALID_HULL'; end if;

  -- 4. no selected hull is already in an open session (any lake)
  if exists (
    select 1 from jsonb_array_elements(p_hulls) h
    join session_watercraft sw on sw.watercraft_id = (h->>'watercraft_id')::uuid
    join sessions s on s.id = sw.session_id and s.ended_at is null
  ) then raise exception 'HULL_IN_USE'; end if;

  -- 5. current time within legal hours for EVERY selected craft type (§2.2)
  v_civil := (p_now at time zone 'America/Chicago')::date;
  select sunrise, sunset into v_sunrise, v_sunset from sun_times where civil_date = v_civil;
  if not found then raise exception 'SUN_TIMES_MISSING'; end if;
  v_tenam := (v_civil + time '10:00') at time zone 'America/Chicago';
  v_has_jet := exists (
    select 1 from jsonb_array_elements(p_hulls) h
    join watercraft w on w.id = (h->>'watercraft_id')::uuid
    where w.craft_type = 'Jet Ski'
  );
  -- Any jet ski in the set tightens the window on BOTH ends (§2.2).
  v_earliest := case when v_has_jet then v_tenam else v_sunrise - interval '30 minutes' end;
  v_latest   := case when v_has_jet then v_sunset else v_sunset + interval '30 minutes' end;
  if p_now < v_earliest or p_now > v_latest then raise exception 'OUT_OF_HOURS'; end if;

  -- 6. open slots >= count(selected)
  select capacity into v_capacity from lakes where id = p_lake_id;
  select count(*) into v_lake_open
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null;
  if v_capacity - v_lake_open < v_selected then raise exception 'LAKE_FULL'; end if;

  -- 7. household_active_hulls + selected <= current fair-share cap (§2.6)
  v_cap := _current_cap(p_lake_id);
  select count(*) into v_open_hulls
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null and s.household_id = p_household_id;
  if v_open_hulls + v_selected > v_cap then raise exception 'OVER_CAP'; end if;

  -- all gates pass → create the session and attach hulls
  insert into sessions (lake_id, household_id, started_by, started_at)
    values (p_lake_id, p_household_id, p_started_by, p_now)
    returning id into v_session_id;

  insert into session_watercraft (session_id, watercraft_id, is_guest_operated, guest_name)
    select v_session_id,
           (h->>'watercraft_id')::uuid,
           coalesce((h->>'is_guest_operated')::boolean, false),
           nullif(h->>'guest_name', '')
      from jsonb_array_elements(p_hulls) h;

  perform _recompute(p_lake_id, p_now);
  return v_session_id;
end $$;

-- ── PUBLIC: check_in ─────────────────────────────────────────────────────────
create or replace function check_in(
  p_lake_id      uuid,
  p_household_id uuid,
  p_started_by   uuid,
  p_hulls        jsonb,
  p_now          timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_session_id uuid;
begin
  perform 1 from lakes where id = p_lake_id for update;   -- serialize on the lake
  if not found then raise exception 'LAKE_NOT_FOUND'; end if;
  v_session_id := _checkin_core(p_lake_id, p_household_id, p_started_by, p_hulls, p_now);
  return v_session_id;
end $$;

-- ── PUBLIC: join_queue (§2.7; cooldown blocks queueing, §2.5) ─────────────────
create or replace function join_queue(
  p_lake_id      uuid,
  p_household_id uuid,
  p_requested_by uuid,
  p_now          timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from lakes where id = p_lake_id for update;
  if not found then raise exception 'LAKE_NOT_FOUND'; end if;

  if exists (
    select 1 from households
     where id = p_household_id
       and (status = 'suspended'
            or (suspended_until is not null and suspended_until > p_now))
  ) then raise exception 'SUSPENDED'; end if;

  -- Cooldown blocks queueing too, or the exploit reopens (§2.5, §13).
  if exists (
    select 1 from cooldowns where household_id = p_household_id and expires_at > p_now
  ) then raise exception 'COOLDOWN'; end if;

  if exists (
    select 1 from queue_entries
     where lake_id = p_lake_id and household_id = p_household_id
       and status in ('waiting','offered')
  ) then raise exception 'ALREADY_QUEUED'; end if;

  insert into queue_entries (lake_id, household_id, requested_by, joined_at)
    values (p_lake_id, p_household_id, p_requested_by, p_now)
    returning id into v_id;

  perform _recompute(p_lake_id, p_now);   -- a new waiter lowers caps → clamp
  return v_id;
end $$;

-- ── PUBLIC: accept_offer (LAUNCH) ────────────────────────────────────────────
create or replace function accept_offer(
  p_queue_entry_id uuid,
  p_started_by     uuid,
  p_hulls          jsonb,
  p_now            timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_lake uuid; v_household uuid; v_status text; v_expires timestamptz; v_session uuid;
begin
  select lake_id, household_id, status, offer_expires_at
    into v_lake, v_household, v_status, v_expires
    from queue_entries where id = p_queue_entry_id;
  if not found then raise exception 'OFFER_INVALID'; end if;

  perform 1 from lakes where id = v_lake for update;

  if v_status <> 'offered' then raise exception 'OFFER_INVALID'; end if;
  if v_expires is not null and v_expires <= p_now then raise exception 'OFFER_EXPIRED'; end if;

  v_session := _checkin_core(v_lake, v_household, p_started_by, p_hulls, p_now);

  update queue_entries set status = 'launched' where id = p_queue_entry_id;
  perform _recompute(v_lake, p_now);
  return v_session;
end $$;

-- ── PUBLIC: pass_offer (PASS) ────────────────────────────────────────────────
-- One pass drops a position; two passes go to the back of the queue (§2.7).
create or replace function pass_offer(
  p_queue_entry_id uuid,
  p_now            timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare v_lake uuid; v_status text; v_passes int; v_next_joined timestamptz;
begin
  select lake_id, status, pass_count into v_lake, v_status, v_passes
    from queue_entries where id = p_queue_entry_id;
  if not found then raise exception 'OFFER_INVALID'; end if;

  perform 1 from lakes where id = v_lake for update;
  if v_status <> 'offered' then raise exception 'OFFER_INVALID'; end if;

  v_passes := v_passes + 1;
  if v_passes >= 2 then
    -- back of the queue
    update queue_entries
       set status = 'waiting', pass_count = v_passes, joined_at = p_now,
           offered_at = null, offer_expires_at = null
     where id = p_queue_entry_id;
  else
    -- drop exactly one position: move just behind the next waiting entry
    select min(joined_at) into v_next_joined
      from queue_entries
     where lake_id = v_lake and status = 'waiting' and id <> p_queue_entry_id
       and joined_at > (select joined_at from queue_entries where id = p_queue_entry_id);
    update queue_entries
       set status = 'waiting', pass_count = v_passes,
           joined_at = coalesce(v_next_joined + interval '1 microsecond', joined_at),
           offered_at = null, offer_expires_at = null
     where id = p_queue_entry_id;
  end if;

  perform _promote(v_lake, p_now);
  perform _recompute(v_lake, p_now);
end $$;

-- ── PUBLIC: end_session ──────────────────────────────────────────────────────
-- Reasons: 'user' | 'auto_expire' | 'admin' | 'clamp'. Creates a household
-- cooldown when the session ended under queue/clamp pressure; auto_expire also
-- flags a no-checkout violation (FLAGGED only — never auto-fine, §13).
create or replace function end_session(
  p_session_id uuid,
  p_reason     text,
  p_now        timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare v_lake uuid; v_household uuid; v_hard timestamptz; v_lastcall boolean; v_ended timestamptz;
begin
  select lake_id, household_id, hard_end_at, last_call, ended_at
    into v_lake, v_household, v_hard, v_lastcall, v_ended
    from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_ended is not null then return; end if;   -- idempotent

  perform 1 from lakes where id = v_lake for update;

  update sessions
     set ended_at = p_now, ended_reason = p_reason
   where id = p_session_id;

  -- Cooldown (§2.4/§2.5): the session was under queue pressure (had a hard end) or
  -- was clamped. Admin voids do not punish the household.
  if p_reason <> 'admin' and (v_hard is not null or v_lastcall) then
    insert into cooldowns (household_id, expires_at, source_session_id)
      values (v_household, p_now + interval '60 minutes', p_session_id);
  end if;

  -- Auto-expire = failed to check out → flag app-usage violation (human confirms).
  if p_reason = 'auto_expire' then
    insert into violations (household_id, track, kind, detected_at, session_id, status)
      values (v_household, 'app_usage', 'no_checkout', p_now, p_session_id, 'flagged');
  end if;

  perform _promote(v_lake, p_now);
  perform _recompute(v_lake, p_now);
end $$;

-- ── PUBLIC: sweep — the every-minute job (§5) ────────────────────────────────
-- Ends sessions past their hard end OR past their legal hours; expires stale
-- offers; promotes the next in queue; recomputes caps. Idempotent; safe to run
-- every minute. Returns a small json summary for the cron log.
create or replace function sweep(p_now timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_ended int := 0;
  v_offers_expired int := 0;
  v_civil date;
  v_sunrise timestamptz;
  v_sunset timestamptz;
  v_has_jet boolean;
  v_latest timestamptz;
begin
  -- 1. End sessions whose queue-imposed hard end has passed.
  for r in
    select id from sessions where ended_at is null and hard_end_at is not null and hard_end_at <= p_now
    order by hard_end_at
  loop
    perform end_session(r.id, 'auto_expire', p_now);
    v_ended := v_ended + 1;
  end loop;

  -- 2. End sessions that have run past their legal hours (failure to check out).
  --    Key off each session's OWN start-day sun times so an overnight straggler
  --    (past yesterday's sunset) is still swept the next morning.
  for r in
    select s.id, s.lake_id, s.started_at
      from sessions s where s.ended_at is null
  loop
    v_civil := (r.started_at at time zone 'America/Chicago')::date;
    select sunrise, sunset into v_sunrise, v_sunset from sun_times where civil_date = v_civil;
    if found then
      select exists (
        select 1 from session_watercraft sw
        join watercraft w on w.id = sw.watercraft_id
        where sw.session_id = r.id and w.craft_type = 'Jet Ski'
      ) into v_has_jet;
      v_latest := case when v_has_jet then v_sunset else v_sunset + interval '30 minutes' end;
      if p_now > v_latest then
        perform end_session(r.id, 'auto_expire', p_now);
        v_ended := v_ended + 1;
      end if;
    end if;
  end loop;

  -- 3. Expire stale offers (no LAUNCH within the 10-min hold → auto-pass).
  for r in
    select id from queue_entries
     where status = 'offered' and offer_expires_at is not null and offer_expires_at <= p_now
  loop
    perform pass_offer(r.id, p_now);
    v_offers_expired := v_offers_expired + 1;
  end loop;

  -- 4. Promote + recompute for every lake.
  for r in select id from lakes loop
    perform _promote(r.id, p_now);
    perform _recompute(r.id, p_now);
  end loop;

  return jsonb_build_object(
    'ran_at', p_now,
    'sessions_ended', v_ended,
    'offers_expired', v_offers_expired
  );
end $$;

-- ── Lock these down: service_role only. Server actions authenticate first. ────
revoke execute on function check_in(uuid,uuid,uuid,jsonb,timestamptz)  from public;
revoke execute on function join_queue(uuid,uuid,uuid,timestamptz)      from public;
revoke execute on function accept_offer(uuid,uuid,jsonb,timestamptz)   from public;
revoke execute on function pass_offer(uuid,timestamptz)                from public;
revoke execute on function end_session(uuid,text,timestamptz)          from public;
revoke execute on function sweep(timestamptz)                          from public;
revoke execute on function _current_cap(uuid)                          from public;
revoke execute on function _recompute(uuid,timestamptz)                from public;
revoke execute on function _promote(uuid,timestamptz)                  from public;
revoke execute on function _checkin_core(uuid,uuid,uuid,jsonb,timestamptz) from public;

grant execute on function check_in(uuid,uuid,uuid,jsonb,timestamptz)   to service_role;
grant execute on function join_queue(uuid,uuid,uuid,timestamptz)       to service_role;
grant execute on function accept_offer(uuid,uuid,jsonb,timestamptz)    to service_role;
grant execute on function pass_offer(uuid,timestamptz)                 to service_role;
grant execute on function end_session(uuid,text,timestamptz)           to service_role;
grant execute on function sweep(timestamptz)                           to service_role;
