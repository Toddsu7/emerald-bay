import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { getBoard } from '@/lib/board';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOffer } from '@/lib/offer';
import { chicagoClock } from '@/lib/sun';
import { CheckInForm, type FormLake, type FormHull, type FormSession, type Restriction } from '@/components/CheckInForm';
import { OfferPanel } from '@/components/OfferPanel';

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
          View lake status →
        </Link>
      </main>
    );
  }

  const boards = await getBoard();

  const { data: hullsRaw } = await supabase
    .from('watercraft')
    .select('id, sticker_number, craft_type, thumb_url')
    .eq('household_id', member.householdId)
    .eq('is_checkinable', true)
    .eq('active', true)
    .order('sticker_number');

  // Photo nag (§10) + household prompt (§7).
  const { count: missingPhotos } = await supabase
    .from('watercraft')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', member.householdId)
    .is('photo_url', null);
  const { count: memberCount } = await supabase
    .from('members')
    .select('*', { count: 'exact', head: true })
    .eq('household_id', member.householdId);

  const { data: inUseRaw } = await supabase
    .from('session_watercraft')
    .select('watercraft_id, sessions!inner(ended_at)')
    .is('sessions.ended_at', null);
  const inUse = new Set((inUseRaw ?? []).map((r: any) => r.watercraft_id));

  const hulls: FormHull[] = (hullsRaw ?? []).map((h: any) => ({
    id: h.id,
    sticker: h.sticker_number,
    craftType: h.craft_type,
    thumbUrl: h.thumb_url ?? null,
    onWater: inUse.has(h.id),
  }));

  const { data: mySessionsRaw } = await supabase
    .from('sessions')
    .select(
      'id, lake_id, hard_end_at, last_call, session_watercraft(watercraft(sticker_number))',
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
    blockEndClock: s.hard_end_at ? chicagoClock(new Date(s.hard_end_at)) : null,
    willRenew: !s.last_call,
    stickers: (s.session_watercraft ?? []).map(
      (sw: any) => sw.watercraft?.sticker_number,
    ),
  }));

  const { data: myQueue } = await supabase
    .from('queue_entries')
    .select('lake_id')
    .eq('household_id', member.householdId)
    .in('status', ['waiting', 'offered']);
  const queuedLakes = new Set((myQueue ?? []).map((q: any) => q.lake_id));

  const lakes: FormLake[] = boards.map((b) => ({
    id: b.id,
    name: b.name,
    slots: b.slots,
    cap: b.cap,
    householdsWaiting: b.householdsWaiting,
    alreadyQueued: queuedLakes.has(b.id),
  }));

  // Outstanding queue offer → in-app LAUNCH/PASS (§2.7), no SMS required.
  const offer = await getActiveOffer(member.householdId);

  // Suspension / cooldown → show the reason + lift time instead of buttons that
  // would just be refused. (cooldowns are board-only under RLS → use the admin read.)
  const admin = createAdminClient();
  let restriction: Restriction | null = null;
  const { data: hh } = await admin
    .from('households')
    .select('status, suspended_until')
    .eq('id', member.householdId)
    .maybeSingle();
  if (
    hh &&
    (hh.status === 'suspended' ||
      (hh.suspended_until && new Date(hh.suspended_until).getTime() > Date.now()))
  ) {
    restriction = {
      kind: 'suspended',
      until: hh.suspended_until
        ? new Date(hh.suspended_until).toLocaleDateString()
        : 'further notice',
    };
  } else {
    const { data: cd } = await admin
      .from('cooldowns')
      .select('expires_at')
      .eq('household_id', member.householdId)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cd) restriction = { kind: 'cooldown', until: chicagoClock(new Date(cd.expires_at)) };
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-bay-700 dark:text-bay-500">Check in</h1>
            <p className="text-sm text-slate-500">{member.householdName}</p>
          </div>
          <Link href="/board" className="text-sm text-bay-700 dark:text-bay-500">
            Lake Status →
          </Link>
        </div>
        <nav className="mt-2 flex gap-4 text-sm text-bay-700 dark:text-bay-500">
          <Link href="/hulls">Photos</Link>
          <Link href="/household">Household &amp; members</Link>
        </nav>
      </header>

      <div className="mb-4 flex flex-col gap-2">
        {missingPhotos && missingPhotos > 0 ? (
          <Link
            href="/hulls"
            className="block rounded-lg bg-amber-50 p-3 text-sm text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200"
          >
            You&apos;re required to upload a photo of each of your watercraft. Make it a
            nice one. <span className="font-semibold underline">Add photos →</span>
          </Link>
        ) : null}
        {(memberCount ?? 1) <= 1 ? (
          <Link
            href="/household"
            className="block rounded-lg bg-bay-50 p-3 text-sm text-bay-800 hover:bg-bay-100 dark:bg-slate-900 dark:text-bay-200"
          >
            Need to add your spouse or kids so they can check in?{' '}
            <span className="font-semibold underline">Manage household →</span>
          </Link>
        ) : null}
      </div>

      {offer && <OfferPanel offer={offer} hulls={hulls} />}

      <CheckInForm
        lakes={lakes}
        hulls={hulls}
        mySessions={mySessions}
        restriction={restriction}
      />
    </main>
  );
}
