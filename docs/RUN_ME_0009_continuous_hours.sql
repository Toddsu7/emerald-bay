-- 0009_continuous_hours — Emerald Bay: session timing rebuilt to the rules doc's
-- "1-hour continuous use, then ≥1-hour non-use," continuous FROM check-in.
--
-- OLD (wrong): when a queue formed, every session got a FRESH hour via
--   max(now+10m, started_at+60m) — a 5-min-old and a 50-min-old session both got a
--   new hour, and the queue could wait a full hour regardless of time already used.
--
-- NEW: hours run in fixed 1-hour blocks from started_at (2:13, 3:13, 4:13…), never
--   reset, never extended. At each boundary the queue is evaluated:
--     • no one waiting  → auto-renew (block boundary advances, no interruption)
--     • someone waiting → end AT the boundary, household cooldown, promote the queue
--   Strict boundary — the now+10m floor is GONE. hard_end_at is repurposed as the
--   CURRENT block boundary (set to started_at+1h at check-in, advanced on renewal).
--   last_call now means "a queue is waiting, so this block will not renew."
--
-- Consequence (flagged in the handoff): auto-rotation is the system working as
-- designed, so it no longer auto-FLAGS a no-checkout violation — a session that hits
-- its boundary or sunset is not a member failure. no_checkout stays board-enterable.

-- ── core gate + insert: now stamps the first block boundary at check-in ───────
create or replace function _checkin_core(
  p_lake_id      uuid,
  p_household_id uuid,
  p_started_by   uuid,
  p_hulls        jsonb,
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

  if exists (
    select 1 from households
     where id = p_household_id
       and (status = 'suspended'
            or (suspended_until is not null and suspended_until > p_now))
  ) then raise exception 'SUSPENDED'; end if;

  if exists (
    select 1 from cooldowns where household_id = p_household_id and expires_at > p_now
  ) then raise exception 'COOLDOWN'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_hulls) h
    left join watercraft w on w.id = (h->>'watercraft_id')::uuid
    where w.id is null
       or w.household_id <> p_household_id
       or w.active = false
       or w.is_checkinable = false
  ) then raise exception 'INVALID_HULL'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_hulls) h
    join session_watercraft sw on sw.watercraft_id = (h->>'watercraft_id')::uuid
    join sessions s on s.id = sw.session_id and s.ended_at is null
  ) then raise exception 'HULL_IN_USE'; end if;

  v_civil := (p_now at time zone 'America/Chicago')::date;
  select sunrise, sunset into v_sunrise, v_sunset from sun_times where civil_date = v_civil;
  if not found then raise exception 'SUN_TIMES_MISSING'; end if;
  v_tenam := (v_civil + time '10:00') at time zone 'America/Chicago';
  v_has_jet := exists (
    select 1 from jsonb_array_elements(p_hulls) h
    join watercraft w on w.id = (h->>'watercraft_id')::uuid
    where w.craft_type = 'Jet Ski'
  );
  v_earliest := case when v_has_jet then v_tenam else v_sunrise - interval '30 minutes' end;
  v_latest   := case when v_has_jet then v_sunset else v_sunset + interval '30 minutes' end;
  if p_now < v_earliest or p_now > v_latest then raise exception 'OUT_OF_HOURS'; end if;

  select capacity into v_capacity from lakes where id = p_lake_id;
  select count(*) into v_lake_open
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null;
  if v_capacity - v_lake_open < v_selected then raise exception 'LAKE_FULL'; end if;

  v_cap := _current_cap(p_lake_id);
  select count(*) into v_open_hulls
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null and s.household_id = p_household_id;
  if v_open_hulls + v_selected > v_cap then raise exception 'OVER_CAP'; end if;

  -- NEW: stamp the first 1-hour block boundary at check-in.
  insert into sessions (lake_id, household_id, started_by, started_at, hard_end_at)
    values (p_lake_id, p_household_id, p_started_by, p_now, p_now + interval '1 hour')
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

-- ── recompute: last_call = "a queue is waiting → this block will not renew" ───
create or replace function _recompute(p_lake_id uuid, p_now timestamptz)
returns void language plpgsql as $$
declare v_queue boolean;
begin
  select exists (
    select 1 from queue_entries where lake_id = p_lake_id and status in ('waiting','offered')
  ) into v_queue;
  update sessions
     set last_call = v_queue
   where lake_id = p_lake_id and ended_at is null and last_call is distinct from v_queue;
end $$;

-- ── end_session: cooldown when coming off while others wait (no auto-violation) ─
create or replace function end_session(
  p_session_id uuid,
  p_reason     text,
  p_now        timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare v_lake uuid; v_household uuid; v_ended timestamptz;
begin
  select lake_id, household_id, ended_at into v_lake, v_household, v_ended
    from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_ended is not null then return; end if;

  perform 1 from lakes where id = v_lake for update;

  update sessions set ended_at = p_now, ended_reason = p_reason where id = p_session_id;

  -- Coming off while others are waiting → 60-min non-use period (rules doc). Applies
  -- to the boundary auto-end AND a voluntary checkout with a queue. No queue → no
  -- cooldown (you left freely and may return). Admin voids never punish.
  if p_reason <> 'admin' and exists (
    select 1 from queue_entries where lake_id = v_lake and status in ('waiting','offered')
  ) then
    insert into cooldowns (household_id, expires_at, source_session_id)
      values (v_household, p_now + interval '60 minutes', p_session_id);
  end if;

  perform _promote(v_lake, p_now);
  perform _recompute(v_lake, p_now);
end $$;

-- ── sweep: sunset stop + per-boundary renew-or-rotate ────────────────────────
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
  v_sunset_stop timestamptz;
  v_block timestamptz;
  v_queue boolean;
begin
  for r in select id, lake_id, started_at, hard_end_at from sessions where ended_at is null
  loop
    -- Sunset hard stop (§2.2), keyed to the session's own start day.
    v_civil := (r.started_at at time zone 'America/Chicago')::date;
    select sunrise, sunset into v_sunrise, v_sunset from sun_times where civil_date = v_civil;
    if found then
      select exists (
        select 1 from session_watercraft sw
        join watercraft w on w.id = sw.watercraft_id
        where sw.session_id = r.id and w.craft_type = 'Jet Ski'
      ) into v_has_jet;
      v_sunset_stop := case when v_has_jet then v_sunset else v_sunset + interval '30 minutes' end;
      if p_now > v_sunset_stop then
        perform end_session(r.id, 'auto_expire', v_sunset_stop);
        v_ended := v_ended + 1;
        continue;
      end if;
    end if;

    -- Block boundaries: evaluate each boundary the session has reached. No queue →
    -- renew (advance the boundary). Queue → end AT the boundary. No grace floor.
    v_block := r.hard_end_at;
    if v_block is not null then
      loop
        exit when p_now < v_block;
        select exists (
          select 1 from queue_entries where lake_id = r.lake_id and status in ('waiting','offered')
        ) into v_queue;
        if v_queue then
          perform end_session(r.id, 'auto_expire', v_block);
          v_ended := v_ended + 1;
          exit;
        else
          v_block := v_block + interval '1 hour';
          update sessions set hard_end_at = v_block where id = r.id;
        end if;
      end loop;
    end if;
  end loop;

  -- Expire stale offers (no LAUNCH within the 10-min hold → auto-pass).
  for r in
    select id from queue_entries
     where status = 'offered' and offer_expires_at is not null and offer_expires_at <= p_now
  loop
    perform pass_offer(r.id, p_now);
    v_offers_expired := v_offers_expired + 1;
  end loop;

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

-- Preserve the service_role-only lockdown across the replaces (defensive; REPLACE
-- keeps ACLs, but be explicit).
revoke execute on function _checkin_core(uuid,uuid,uuid,jsonb,timestamptz) from public;
revoke execute on function _recompute(uuid,timestamptz)                    from public;
revoke execute on function end_session(uuid,text,timestamptz)              from public;
revoke execute on function sweep(timestamptz)                              from public;
grant  execute on function end_session(uuid,text,timestamptz)              to service_role;
grant  execute on function sweep(timestamptz)                              to service_role;
