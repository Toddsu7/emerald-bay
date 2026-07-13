'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { endSessionAction } from '@/lib/actions/checkin';

export interface ActiveSession {
  id: string;
  lakeName: string;
  stickers: number[];
}

// Persistent "You're on the water — Check out" bar, shown at the top of EVERY page
// while the household has an open session (§ failure-to-check-out is the #1 problem).
// The button checks out directly — no navigating to fix it.
export function CheckoutBar({ sessions }: { sessions: ActiveSession[] }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const router = useRouter();

  function checkout(id: string) {
    setErr('');
    start(async () => {
      const res = await endSessionAction(id);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="sticky top-0 z-40 bg-amber-500 text-amber-950">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span className="font-semibold">You&apos;re on the water.</span>
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => checkout(s.id)}
            disabled={pending}
            className="rounded-md bg-amber-950 px-2.5 py-1 text-xs font-medium text-amber-50 disabled:opacity-50"
          >
            Check out {s.lakeName} {s.stickers.map((n) => `#${n}`).join(', ')}
          </button>
        ))}
        {err && <span className="text-xs font-medium text-red-900">{err}</span>}
      </div>
    </div>
  );
}
