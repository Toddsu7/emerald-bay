-- 0012_no_queue_with_room — Emerald Bay: a queue exists to WAIT for a slot. If the
-- lake has open slots there is nothing to wait for — the only action is check-in.
-- Reject join_queue server-side (not just in the UI) when the lake has room, with a
-- clear refusal carrying the open-slot count.
create or replace function join_queue(
  p_lake_id      uuid,
  p_household_id uuid,
  p_requested_by uuid,
  p_now          timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_capacity int; v_open int;
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

  -- Nothing to wait for if the lake has room — check in instead.
  select capacity into v_capacity from lakes where id = p_lake_id;
  select count(*) into v_open
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null;
  if v_capacity - v_open > 0 then
    raise exception 'LAKE_HAS_ROOM' using detail = (v_capacity - v_open)::text;
  end if;

  insert into queue_entries (lake_id, household_id, requested_by, joined_at)
    values (p_lake_id, p_household_id, p_requested_by, p_now)
    returning id into v_id;

  perform _recompute(p_lake_id, p_now);
  return v_id;
end $$;

revoke execute on function join_queue(uuid,uuid,uuid,timestamptz) from public;
grant  execute on function join_queue(uuid,uuid,uuid,timestamptz) to service_role;
