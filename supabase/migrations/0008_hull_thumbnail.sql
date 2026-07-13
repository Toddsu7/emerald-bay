-- 0008_hull_thumbnail — Emerald Bay: store a small WebP thumbnail URL alongside the
-- full-size photo. Lists serve the thumbnail (~128px WebP); the full-size original is
-- loaded only when the Lake Status lightbox opens. Resizing happens at UPLOAD time
-- (sharp), never on display — a household with 5 hulls must not pull 20 MB at the ramp.
alter table watercraft add column if not exists thumb_url text;
