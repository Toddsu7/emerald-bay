'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { passAction } from '@/lib/actions/queue';
import { useCountdown } from '@/components/useCountdown';
import type { ActiveOffer } from '@/lib/offer';

// Persistent offer bar (like the check-out bar): shown on every page while the
// household has an outstanding queue offer, so a promoted household is never
// stranded with no way to accept in the app (§2.7). Launch (which needs hull
// selection) links to /checkin; Pass acts inline.
export function OfferBar({ offer }: { offer: ActiveOffer }) {
  const { label, expired, ready } = useCountdown(offer.offerExpiresAt);
  const [pending, start] = useTransition();
  const router = useRouter();

  function pass() {
    start(async () => {
      await passAction(offer.queueEntryId);
      router.refresh();
    });
  }

  return (
    <div className="sticky top-0 z-40 bg-bay-600 text-white">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-semibold">A slot opened on {offer.lakeName}.</span>
        {ready && !expired ? (
          <span>You have {label} to launch.</span>
        ) : expired ? (
          <span>Offer expiring…</span>
        ) : null}
        <Link
          href="/checkin"
          className="ml-auto rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-bay-700"
        >
          Launch →
        </Link>
        <button
          onClick={pass}
          disabled={pending}
          className="rounded-md border border-white/60 px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Pass
        </button>
      </div>
    </div>
  );
}
