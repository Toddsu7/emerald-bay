'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { engineMessage } from '@/lib/errors';
import type { ActionResult } from '@/lib/actions/checkin';

async function requireBoard() {
  const member = await getCurrentMember();
  if (!member?.isAdmin) return null;
  return member;
}

/**
 * Confirm a flagged violation (§2.8). Board-only. Applies the schedule default for
 * the household's next offense in that track, unless the board overrides the
 * amounts. Never auto-fined — this is the human confirmation step (§13). A
 * suspension is time-boxed via households.suspended_until (auto-expires).
 */
export async function confirmViolation(input: {
  id: string;
  fineAmount?: number | null;
  suspensionDays?: number | null;
}): Promise<ActionResult> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();

  const { data: v } = await admin.from('violations').select('*').eq('id', input.id).maybeSingle();
  if (!v) return { ok: false, error: 'Violation not found.' };

  // Offense number = (confirmed count in this track for the household) + 1.
  const { count } = await admin
    .from('violations')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', v.household_id)
    .eq('track', v.track)
    .eq('status', 'confirmed');
  const offense = (count ?? 0) + 1;

  const { data: sched } = await admin
    .from('violation_schedule')
    .select('fine_amount, suspension_days')
    .eq('track', v.track)
    .eq('offense_number', offense)
    .maybeSingle();

  const fine = input.fineAmount !== undefined ? input.fineAmount : sched?.fine_amount ?? null;
  const days =
    input.suspensionDays !== undefined ? input.suspensionDays : sched?.suspension_days ?? null;

  await admin
    .from('violations')
    .update({ status: 'confirmed', reviewed_by: board.id, fine_amount: fine, suspension_days: days })
    .eq('id', input.id);

  if (days && days > 0) {
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    await admin.from('households').update({ suspended_until: until }).eq('id', v.household_id);
  }
  revalidatePath('/admin');
  return { ok: true };
}

export async function dismissViolation(id: string): Promise<ActionResult> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  await admin.from('violations').update({ status: 'dismissed', reviewed_by: board.id }).eq('id', id);
  revalidatePath('/admin');
  return { ok: true };
}

/** Board-entered violation (music/profanity, speed, no-checkin, etc. — §2.8). */
export async function createViolation(input: {
  householdId: string;
  track: 'app_usage' | 'music' | 'other';
  kind: string;
  notes?: string;
}): Promise<ActionResult> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const { error } = await admin.from('violations').insert({
    household_id: input.householdId,
    track: input.track,
    kind: input.kind,
    status: 'flagged',
    notes: input.notes ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true };
}

/** Admin override — force-end any open session (§5 admin void). */
export async function adminEndSession(sessionId: string): Promise<ActionResult> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const { error } = await admin.rpc('end_session', { p_session_id: sessionId, p_reason: 'admin' });
  if (error) return { ok: false, error: engineMessage(error) };
  revalidatePath('/admin');
  revalidatePath('/board');
  return { ok: true };
}

/** Lift a household's suspension early. */
export async function liftSuspension(householdId: string): Promise<ActionResult> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  await admin
    .from('households')
    .update({ status: 'active', suspended_until: null })
    .eq('id', householdId);
  revalidatePath('/admin');
  return { ok: true };
}

/** Edit a violation-schedule row (§12.1 board sets the numbers, no deploy). */
export async function updateScheduleRow(input: {
  track: string;
  offenseNumber: number;
  fineAmount: number | null;
  suspensionDays: number | null;
}): Promise<ActionResult> {
  const board = await requireBoard();
  if (!board) return { ok: false, error: 'Board only.' };
  const admin = createAdminClient();
  const { error } = await admin
    .from('violation_schedule')
    .update({ fine_amount: input.fineAmount, suspension_days: input.suspensionDays })
    .eq('track', input.track)
    .eq('offense_number', input.offenseNumber);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin');
  return { ok: true };
}
