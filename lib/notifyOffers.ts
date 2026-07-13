// Send the "slot open — reply LAUNCH within 10 min" notification (§2.7, §9) for
// any offered queue entry that hasn't been notified yet. Called by the cron after
// each sweep so an offer fires exactly once. Dormant-safe (senders no-op unkeyed).
import { createAdminClient } from '@/lib/supabase/admin';
import { sendSms, sendPush } from '@/lib/notify';
import { chicagoClock } from '@/lib/sun';

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function notifyPendingOffers(): Promise<{ notified: number }> {
  const admin = createAdminClient();
  const { data: offers } = await admin
    .from('queue_entries')
    .select('id, lake_id, household_id, offer_expires_at, lakes(name)')
    .eq('status', 'offered')
    .eq('offer_notified', false);
  if (!offers?.length) return { notified: 0 };

  let notified = 0;
  for (const o of offers as any[]) {
    const lakeName = o.lakes?.name ?? 'the lake';
    const by = o.offer_expires_at ? ` (by ${chicagoClock(new Date(o.offer_expires_at))})` : '';
    const body = `Emerald Bay: a slot opened on ${lakeName}. Reply LAUNCH within 10 min${by} or you'll drop a spot. Reply PASS to skip.`;

    const { data: members } = await admin
      .from('members')
      .select('id, mobile')
      .eq('household_id', o.household_id);

    for (const m of members ?? []) {
      if (m.mobile) await sendSms(m.mobile, body);
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('subscription')
        .eq('member_id', m.id);
      for (const s of subs ?? []) {
        await sendPush(s.subscription, { title: 'Slot open — Emerald Bay', body });
      }
    }
    await admin.from('queue_entries').update({ offer_notified: true }).eq('id', o.id);
    notified++;
  }
  return { notified };
}
