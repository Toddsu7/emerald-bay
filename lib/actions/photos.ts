'use server';

import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/actions/checkin';

const BUCKET = 'hull-photos';
const THUMB_PX = 128;

/** Upload a photo for one of the household's hulls (§8). Board may upload for any. */
export async function uploadHullPhoto(formData: FormData): Promise<ActionResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };
  const watercraftId = String(formData.get('watercraftId') ?? '');
  const file = formData.get('photo');
  if (!watercraftId || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a photo.' };
  }

  const admin = createAdminClient();
  const { data: hull } = await admin
    .from('watercraft')
    .select('id, household_id, sticker_number')
    .eq('id', watercraftId)
    .maybeSingle();
  if (!hull) return { ok: false, error: 'Watercraft not found.' };
  if (hull.household_id !== member.householdId && !member.isAdmin) {
    return { ok: false, error: 'That isn’t your watercraft.' };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const origPath = `${hull.sticker_number}.${ext}`;
  const thumbPath = `${hull.sticker_number}_thumb.webp`;

  // Full-size original (what the Lake Status lightbox loads on demand).
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(origPath, buf, { contentType: file.type || 'image/jpeg', upsert: true });
  if (upErr) return { ok: false, error: upErr.message };
  const photoUrl = admin.storage.from(BUCKET).getPublicUrl(origPath).data.publicUrl;

  // Thumbnail generated AT UPLOAD (never resize-on-display): ~128px square WebP,
  // EXIF-rotated so phone photos aren't sideways. If sharp fails for any reason we
  // still keep the original; lists fall back to the neutral placeholder.
  let thumbUrl: string | null = null;
  try {
    const thumb = await sharp(buf)
      .rotate()
      .resize(THUMB_PX, THUMB_PX, { fit: 'cover' })
      .webp({ quality: 72 })
      .toBuffer();
    const { error: tErr } = await admin.storage
      .from(BUCKET)
      .upload(thumbPath, thumb, { contentType: 'image/webp', upsert: true });
    if (!tErr) thumbUrl = admin.storage.from(BUCKET).getPublicUrl(thumbPath).data.publicUrl;
  } catch {
    // keep original-only; thumb stays null
  }

  await admin
    .from('watercraft')
    .update({ photo_url: photoUrl, thumb_url: thumbUrl })
    .eq('id', hull.id);

  revalidatePath('/hulls');
  revalidatePath('/board');
  revalidatePath('/checkin');
  return { ok: true };
}
