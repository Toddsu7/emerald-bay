'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ensureSunTimes } from '@/lib/sunSync';
import { engineMessage } from '@/lib/errors';
import { describeCheckInError } from '@/lib/refusal';

export interface HullSelection {
  watercraftId: string;
  isGuestOperated?: boolean;
  guestName?: string | null;
}

export type ActionResult =
  | { ok: true; sessionId?: string }
  | { ok: false; error: string };

/**
 * Check in one or more of the household's hulls on a lake. Authenticates the
 * caller, resolves their household (never trusts a client-supplied household),
 * and calls the lake-locked check_in RPC. Guest-operated hulls (§8) still belong
 * to and count against the household.
 */
export async function checkInAction(input: {
  lakeId: string;
  hulls: HullSelection[];
}): Promise<ActionResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };
  if (!input.hulls?.length) return { ok: false, error: 'Select at least one watercraft.' };

  try {
    await ensureSunTimes();
    const admin = createAdminClient();
    const payload = input.hulls.map((h) => ({
      watercraft_id: h.watercraftId,
      is_guest_operated: !!h.isGuestOperated,
      guest_name: h.guestName ?? null,
    }));
    const { data, error } = await admin.rpc('check_in', {
      p_lake_id: input.lakeId,
      p_household_id: member.householdId,
      p_started_by: member.id,
      p_hulls: payload,
    });
    if (error) {
      return {
        ok: false,
        error: await describeCheckInError(error, {
          lakeId: input.lakeId,
          householdId: member.householdId,
          hullIds: input.hulls.map((h) => h.watercraftId),
        }),
      };
    }
    revalidatePath('/board');
    revalidatePath('/checkin');
    return { ok: true, sessionId: data as string };
  } catch (e) {
    return { ok: false, error: engineMessage(e) };
  }
}

/** End a session the household started (check out). */
export async function endSessionAction(sessionId: string): Promise<ActionResult> {
  const member = await getCurrentMember();
  if (!member) return { ok: false, error: 'You must be signed in.' };
  try {
    const admin = createAdminClient();
    // Verify the session belongs to the caller's household (unless board).
    const { data: session } = await admin
      .from('sessions')
      .select('household_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (!session) return { ok: false, error: 'That session wasn’t found.' };
    if (session.household_id !== member.householdId && !member.isAdmin) {
      return { ok: false, error: 'That isn’t your session.' };
    }
    const reason = member.isAdmin && session.household_id !== member.householdId ? 'admin' : 'user';
    const { error } = await admin.rpc('end_session', {
      p_session_id: sessionId,
      p_reason: reason,
    });
    if (error) return { ok: false, error: engineMessage(error) };
    revalidatePath('/board');
    revalidatePath('/checkin');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: engineMessage(e) };
  }
}
