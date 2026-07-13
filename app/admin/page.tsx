import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { AdminPanel, type AdminData } from '@/components/AdminPanel';
import { RosterManager } from '@/components/RosterManager';

export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function AdminPage() {
  const member = await getCurrentMember();
  if (!member) redirect('/login?next=/admin');
  if (!member.isAdmin) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-slate-600 dark:text-slate-300">
        Board members only.
      </main>
    );
  }

  const admin = createAdminClient();

  const { data: violations } = await admin
    .from('violations')
    .select('id, household_id, track, kind, status, detected_at, households(name)')
    .eq('status', 'flagged')
    .order('detected_at', { ascending: false });

  // For each flag, the household's offense number in that track + the schedule
  // default — the single most important fact when applying (or departing from) it.
  const enrichedViolations = await Promise.all(
    (violations ?? []).map(async (v: any) => {
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
      return {
        id: v.id,
        householdName: v.households?.name ?? '',
        track: v.track,
        kind: v.kind,
        detectedAt: v.detected_at,
        offenseNumber: offense,
        defaultFine: sched?.fine_amount ?? null,
        defaultDays: sched?.suspension_days ?? null,
      };
    }),
  );

  const { data: sessions } = await admin
    .from('sessions')
    .select('id, started_at, last_call, lakes(name), households(name), session_watercraft(watercraft(sticker_number))')
    .is('ended_at', null)
    .order('started_at');

  const { data: schedule } = await admin
    .from('violation_schedule')
    .select('track, offense_number, fine_amount, suspension_days, note')
    .order('track')
    .order('offense_number');

  const nowIso = new Date().toISOString();
  const { data: suspended } = await admin
    .from('households')
    .select('id, name, status, suspended_until')
    .or(`status.eq.suspended,suspended_until.gt.${nowIso}`);

  const data: AdminData = {
    violations: enrichedViolations,
    sessions: (sessions ?? []).map((s: any) => ({
      id: s.id,
      householdName: s.households?.name ?? '',
      lakeName: s.lakes?.name ?? '',
      lastCall: s.last_call,
      stickers: (s.session_watercraft ?? []).map((sw: any) => sw.watercraft?.sticker_number),
    })),
    schedule: (schedule ?? []).map((r: any) => ({
      track: r.track,
      offenseNumber: r.offense_number,
      fineAmount: r.fine_amount,
      suspensionDays: r.suspension_days,
      note: r.note,
    })),
    suspended: (suspended ?? []).map((h: any) => ({
      id: h.id,
      name: h.name,
      status: h.status,
      suspendedUntil: h.suspended_until,
    })),
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-bay-700 dark:text-bay-500">Board admin</h1>
      <div className="flex flex-col gap-10">
        <RosterManager />
        <AdminPanel data={data} />
      </div>
    </main>
  );
}
