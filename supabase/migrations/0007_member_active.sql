-- 0007_member_active — Emerald Bay: let the board deactivate a member without
-- deleting the record (audit trail stays intact). watercraft already has `active`;
-- this adds the equivalent for members. A deactivated member cannot act — the auth
-- resolver (getCurrentMember) treats them as unlinked.
alter table members add column if not exists active boolean not null default true;
create index if not exists members_active_idx on members (household_id) where active;
