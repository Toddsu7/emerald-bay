'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { engineMessage, matchCode } from '@/lib/errors';
import { describeCheckInError } from '@/lib/refusal';
import type { ActionResult, HullSelection } from '@/lib/actions/checkin';

/** Join a lake's queue (§2.7). Cooldown/suspension block this in the engine (§2.5);
 *  a lake with open slots is refused ("check in instead"). */
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
    if (error) {
      if (matchCode(error) === 'LAKE_HAS_ROOM') {
        const [{ data: lake }, { data: sw }] = await Promise.all([
          admin.from('lakes').select('name, capacity').eq('id', lakeId).maybeSingle(),
          admin
            .from('session_watercraft')
            .select('watercraft_id, sessions!inner(lake_id, ended_at)')
            .eq('sessions.lake_id', lakeId)
            .is('sessions.ended_at', null),
        ]);
        const open = (lake?.capacity ?? 0) - (sw?.length ?? 0);
        return {
          ok: false,
          error: `${lake?.name ?? 'The lake'} has ${open} open slot${
            open === 1 ? '' : 's'
          } — check in instead.`,
        };
      }
      return { ok: false, error: engineMessage(error) };
    }
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
    if (error) {
      const { data: entry } = await admin
        .from('queue_entries')
        .select('lake_id')
        .eq('id', input.queueEntryId)
        .maybeSingle();
      return {
        ok: false,
        error: entry
          ? await describeCheckInError(error, {
              lakeId: entry.lake_id,
              householdId: member.householdId,
              hullIds: input.hulls.map((h) => h.watercraftId),
            })
          : engineMessage(error),
      };
    }
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
