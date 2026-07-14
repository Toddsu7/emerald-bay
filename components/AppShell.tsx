import { getCurrentMember } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOffer, type ActiveOffer } from '@/lib/offer';
import { BottomNav } from '@/components/BottomNav';
import { CheckoutBar, type ActiveSession } from '@/components/CheckoutBar';
import { OfferBar } from '@/components/OfferBar';

// App chrome shown on every route: the persistent check-out bar (when the household
// is on the water) and the persistent bottom nav (when signed in). Unauthenticated
// pages (landing, login) render children only.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function AppShell({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  let active: ActiveSession[] = [];
  let offer: ActiveOffer | null = null;

  try {
    const member = await getCurrentMember();
    if (member) {
      signedIn = true;
      const admin = createAdminClient();
      const [{ data }, offerRes] = await Promise.all([
        admin
          .from('sessions')
          .select('id, lakes(name), session_watercraft(watercraft(sticker_number))')
          .eq('household_id', member.householdId)
          .is('ended_at', null),
        getActiveOffer(member.householdId),
      ]);
      active = (data ?? []).map((s: any) => ({
        id: s.id,
        lakeName: s.lakes?.name ?? '',
        stickers: (s.session_watercraft ?? []).map((sw: any) => sw.watercraft?.sticker_number),
      }));
      offer = offerRes;
    }
  } catch {
    // no session / no env at build → render bare
  }

  return (
    <>
      {offer && <OfferBar offer={offer} />}
      {active.length > 0 && <CheckoutBar sessions={active} />}
      <div className={signedIn ? 'pb-14' : ''}>{children}</div>
      {signedIn && <BottomNav />}
    </>
  );
}
