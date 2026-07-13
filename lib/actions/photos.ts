'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/actions/checkin';

const BUCKET = 'hull-photos';

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

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${hull.sticker_number}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type || 'image/jpeg', upsert: true });
  if (upErr) return { ok: false, error: upErr.message };

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  await admin.from('watercraft').update({ photo_url: pub.publicUrl }).eq('id', hull.id);

  revalidatePath('/hulls');
  revalidatePath('/board');
  return { ok: true };
}
