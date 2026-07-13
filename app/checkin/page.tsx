import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getBoard } from '@/lib/board';
import { createClient } from '@/lib/supabase/server';
import { CheckInForm, type FormLake, type FormHull, type FormSession } from '@/components/CheckInForm';

export const dynamic = 'force-dynamic';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function CheckinPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/checkin');

  const member = await getCurrentMember();
  if (!member) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-slate-600 dark:text-slate-300">
          You&apos;re signed in, but your email isn&apos;t linked to a household yet.
          Ask a board member to confirm your registration.
        </p>
        <Link href="/board" className="mt-6 inline-block text-bay-700 dark:text-bay-500">
          View the board →
        </Link>
      </main>
    );
  }

  const boards = await getBoard();

  const { data: hullsRaw } = await supabase
    .from('watercraft')
    .select('id, sticker_number, craft_type')
    .eq('household_id', member.householdId)
    .eq('is_checkinable', true)
    .eq('active', true)
    .order('sticker_number');

  const { data: inUseRaw } = await supabase
    .from('session_watercraft')
    .select('watercraft_id, sessions!inner(ended_at)')
    .is('sessions.ended_at', null);
  const inUse = new Set((inUseRaw ?? []).map((r: any) => r.watercraft_id));

  const hulls: FormHull[] = (hullsRaw ?? []).map((h: any) => ({
    id: h.id,
    sticker: h.sticker_number,
    craftType: h.craft_type,
    onWater: inUse.has(h.id),
  }));

  const { data: mySessionsRaw } = await supabase
    .from('sessions')
    .select(
      'id, lake_id, started_at, last_call, session_watercraft(watercraft(sticker_number))',
    )
    .eq('household_id', member.householdId)
    .is('ended_at', null)
    .order('started_at');

  const lakeName: Record<string, string> = Object.fromEntries(
    boards.map((b) => [b.id, b.name]),
  );
  const mySessions: FormSession[] = (mySessionsRaw ?? []).map((s: any) => ({
    id: s.id,
    lakeName: lakeName[s.lake_id] ?? '',
    lastCall: s.last_call,
    stickers: (s.session_watercraft ?? []).map(
      (sw: any) => sw.watercraft?.sticker_number,
    ),
  }));

  const lakes: FormLake[] = boards.map((b) => ({
    id: b.id,
    name: b.name,
    slots: b.slots,
    cap: b.cap,
    householdsWaiting: b.householdsWaiting,
  }));

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-bay-700 dark:text-bay-500">Check in</h1>
          <p className="text-sm text-slate-500">{member.householdName}</p>
        </div>
        <Link href="/board" className="text-sm text-bay-700 dark:text-bay-500">
          Board →
        </Link>
      </header>
      <CheckInForm lakes={lakes} hulls={hulls} mySessions={mySessions} />
    </main>
  );
}
