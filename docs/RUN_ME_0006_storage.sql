-- 0006_storage — Emerald Bay (BUILD SPEC §8, §10): public bucket for hull photos.
-- The board is materially less useful without photos (§10) — members upload at
-- first login; the board can bulk-upload later. Uploads go through a server action
-- under the service-role key (bypasses storage RLS); the bucket is public so the
-- board renders photos via their public URL.
insert into storage.buckets (id, name, public)
values ('hull-photos', 'hull-photos', true)
on conflict (id) do nothing;
