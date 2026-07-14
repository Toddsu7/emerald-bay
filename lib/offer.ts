// The household's current queue OFFER, if any — a promoted queue entry awaiting
// LAUNCH/PASS within the 10-minute hold (§2.7). Read via the service-role client
// (queue_entries is association-readable, but we already hold the household id).
import { createAdminClient } from '@/lib/supabase/admin';

export interface ActiveOffer {
  queueEntryId: string;
  lakeId: string;
  lakeName: string;
  offerExpiresAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getActiveOffer(householdId: string): Promise<ActiveOffer | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('queue_entries')
    .select('id, lake_id, offer_expires_at, lakes(name)')
    .eq('household_id', householdId)
    .eq('status', 'offered')
    .order('offered_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    queueEntryId: data.id,
    lakeId: (data as any).lake_id,
    lakeName: (data as any).lakes?.name ?? '',
    offerExpiresAt: (data as any).offer_expires_at,
  };
}
