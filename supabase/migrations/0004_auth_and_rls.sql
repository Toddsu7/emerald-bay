-- 0004_auth_and_rls — Emerald Bay (BUILD SPEC §7): link Supabase auth users to
-- members, and add read RLS policies. Magic-link only, no passwords.
--
-- Model: a member row is linked to a Supabase auth user by email at first login
-- (server action sets members.auth_user_id). Mutations never touch the DB from the
-- client — they go through service-role server actions — so ONLY select policies
-- are needed. No insert/update/delete policies for `authenticated` means the anon
-- client cannot write, by construction.

alter table members add column if not exists auth_user_id uuid unique references auth.users(id);
create index if not exists members_auth_user_idx on members (auth_user_id);

-- Who is the signed-in member? (SECURITY DEFINER so it can read members under RLS.)
create or replace function current_member_household()
returns uuid language sql stable security definer set search_path = public as $$
  select household_id from members where auth_user_id = auth.uid() limit 1;
$$;

create or replace function is_board()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from members where auth_user_id = auth.uid() limit 1), false);
$$;

-- ── Read policies ────────────────────────────────────────────────────────────
-- Association-public (any signed-in member can see the live board, §6):
create policy read_lakes            on lakes              for select to authenticated using (true);
create policy read_sun              on sun_times          for select to authenticated using (true);
create policy read_sessions         on sessions           for select to authenticated using (true);
create policy read_session_wc       on session_watercraft for select to authenticated using (true);
create policy read_watercraft       on watercraft         for select to authenticated using (true);
create policy read_households       on households         for select to authenticated using (true);
create policy read_queue            on queue_entries      for select to authenticated using (true);
create policy read_schedule         on violation_schedule for select to authenticated using (true);

-- Roster carries emails/mobiles → own household or board only:
create policy read_members on members for select to authenticated
  using (household_id = current_member_household() or is_board());

-- Sensitive → board only:
create policy read_violations on violations for select to authenticated using (is_board());
create policy read_cooldowns  on cooldowns  for select to authenticated using (is_board());

-- Board may edit the violation schedule from the admin UI (§11.10). All other
-- writes stay server-side via service_role.
create policy write_schedule on violation_schedule for all to authenticated
  using (is_board()) with check (is_board());
