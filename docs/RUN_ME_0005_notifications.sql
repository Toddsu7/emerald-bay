-- 0005_notifications — Emerald Bay (BUILD SPEC §9): outbound offer notifications
-- and web-push subscriptions. Dormant until Twilio/VAPID keys are set.

-- Track whether the current offer on a queue entry has been notified, so the cron
-- sends each offer exactly once.
alter table queue_entries add column if not exists offer_notified boolean not null default false;

-- Web-push device subscriptions (one row per device endpoint; a member may have
-- several). SMS is the primary ramp channel (§7); push is the fallback.
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete cascade,
  endpoint     text not null unique,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_member_idx on push_subscriptions (member_id);
alter table push_subscriptions enable row level security;

-- Re-offer must re-notify: reset offer_notified whenever _promote creates an offer.
create or replace function _promote(p_lake_id uuid, p_now timestamptz)
returns void language plpgsql as $$
declare v_capacity int; v_open_hulls int; v_front uuid;
begin
  if exists (select 1 from queue_entries where lake_id = p_lake_id and status = 'offered') then
    return;
  end if;
  select capacity into v_capacity from lakes where id = p_lake_id;
  select count(*) into v_open_hulls
    from session_watercraft sw
    join sessions s on s.id = sw.session_id
   where s.lake_id = p_lake_id and s.ended_at is null;
  if v_capacity - v_open_hulls < 1 then
    return;
  end if;
  select id into v_front
    from queue_entries
   where lake_id = p_lake_id and status = 'waiting'
   order by joined_at asc
   limit 1;
  if v_front is null then return; end if;
  update queue_entries
     set status = 'offered', offered_at = p_now,
         offer_expires_at = p_now + interval '10 minutes',
         offer_notified = false
   where id = v_front;
end $$;
revoke execute on function _promote(uuid,timestamptz) from public;
