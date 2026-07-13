-- 0010_flag_no_checkout — Emerald Bay: restore the no-checkout auto-flag, narrowed.
--
-- The distinction (rules doc, failure-to-check-out = the #1 complaint about the old
-- system): the SYSTEM rotating you is not a violation; YOU not coming in when the
-- system told you to is. Under 0009, end_session(auto_expire) is called in exactly
-- two cases — force-ended at a boundary because a queue formed, and ended at sunset
-- — and in BOTH the member never checked out. Auto-RENEWAL on an empty lake never
-- calls end_session, so it is never flagged. So flagging on auto_expire hits exactly
-- the two cases the board wants, and nothing else.
--
-- Flagged only — never auto-fined. A board member reviews and decides ("guidelines,
-- may be departed from based on severity").

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

  -- Coming off while others are waiting → 60-min non-use period (rules doc).
  if p_reason <> 'admin' and exists (
    select 1 from queue_entries where lake_id = v_lake and status in ('waiting','offered')
  ) then
    insert into cooldowns (household_id, expires_at, source_session_id)
      values (v_household, p_now + interval '60 minutes', p_session_id);
  end if;

  -- The SYSTEM ended the session (boundary-with-queue or sunset) → the member never
  -- checked out. Flag for board review; never auto-fine. Auto-renewal never reaches
  -- here, so an empty-lake renewal is never flagged.
  if p_reason = 'auto_expire' then
    insert into violations (household_id, track, kind, detected_at, session_id, status)
      values (v_household, 'app_usage', 'no_checkout', p_now, p_session_id, 'flagged');
  end if;

  perform _promote(v_lake, p_now);
  perform _recompute(v_lake, p_now);
end $$;

revoke execute on function end_session(uuid,text,timestamptz) from public;
grant  execute on function end_session(uuid,text,timestamptz) to service_role;
