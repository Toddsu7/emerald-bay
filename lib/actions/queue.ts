'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { engineMessage } from '@/lib/errors';
import type { ActionResult, HullSelection } from '@/lib/actions/checkin';

/** Join a lake's queue (§2.7). Cooldown/suspension block this in the engine (§2.5). */
export async function joinQueueAction(lakeId: string): Promise<ActionResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc('join_queue', {
      p_lake_id: lakeId,
      p_household_id: member.householdId,
      p_requested_by: member.id,
    });
    if (error) return { ok: false, error: engineMessage(error) };
    revalidatePath('/board');
    revalidatePath('/checkin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: engineMessage(e) };
  }
}

/** LAUNCH — accept an offered slot with the chosen hulls. */
export async function launchAction(input: {
  queueEntryId: string;
  hulls: HullSelection[];
}): Promise<ActionResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };
  if (!input.hulls?.length) return { ok: false, error: 'Select at least one watercraft.' };
  try {
    const admin = createAdminClient();
    const payload = input.hulls.map((h) => ({
      watercraft_id: h.watercraftId,
      is_guest_operated: !!h.isGuestOperated,
      guest_name: h.guestName ?? null,
    }));
    const { data, error } = await admin.rpc('accept_offer', {
      p_queue_entry_id: input.queueEntryId,
      p_started_by: member.id,
      p_hulls: payload,
    });
    if (error) return { ok: false, error: engineMessage(error) };
    revalidatePath('/board');
    revalidatePath('/checkin');
    return { ok: true, sessionId: data as string };
  } catch (e) {
    return { ok: false, error: engineMessage(e) };
  }
}

/** PASS — skip the current offer (drops a position; two passes → back, §2.7). */
export async function passAction(queueEntryId: string): Promise<ActionResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc('pass_offer', { p_queue_entry_id: queueEntryId });
    if (error) return { ok: false, error: engineMessage(error) };
    revalidatePath('/board');
    revalidatePath('/checkin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: engineMessage(e) };
  }
}
