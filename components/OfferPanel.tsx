'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { launchAction, passAction } from '@/lib/actions/queue';
import { useCountdown } from '@/components/useCountdown';
import { HullThumb } from '@/components/HullThumb';
import type { FormHull } from '@/components/CheckInForm';
import type { ActiveOffer } from '@/lib/offer';

// The in-app LAUNCH flow on /checkin. The offer is for the HOUSEHOLD, not a specific
// boat, so the member picks the hull(s) — same selection as check-in — then LAUNCH.
// PASS drops a position (two → back of queue, handled in the engine); auto-pass at
// expiry is the sweep's job.
export function OfferPanel({ offer, hulls }: { offer: ActiveOffer; hulls: FormHull[] }) {
  const { label, expired, ready } = useCountdown(offer.offerExpiresAt);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const ids = Object.keys(selected).filter((id) => selected[id]);

  function launch() {
    setErr('');
    start(async () => {
      const res = await launchAction({
        queueEntryId: offer.queueEntryId,
        hulls: ids.map((id) => ({ watercraftId: id })),
      });
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }
  function pass() {
    setErr('');
    start(async () => {
      const res = await passAction(offer.queueEntryId);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="mb-4 rounded-xl border-2 border-bay-500 bg-bay-50 p-4 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-bay-800 dark:text-bay-300">
          A slot opened on {offer.lakeName}
        </h2>
        {ready && !expired ? (
          <span className="text-sm font-semibold tabular-nums text-bay-700 dark:text-bay-400">
            {label} to launch
          </span>
        ) : expired ? (
          <span className="text-sm text-red-600">Offer expiring…</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Pick the watercraft to launch, then tap Launch.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {hulls.map((h) => (
          <li
            key={h.id}
            className={`rounded-lg border p-2 ${
              selected[h.id] ? 'border-bay-600' : 'border-slate-200 dark:border-slate-800'
            } ${h.onWater ? 'opacity-50' : ''}`}
          >
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                disabled={h.onWater}
                checked={!!selected[h.id]}
                onChange={() => setSelected((p) => ({ ...p, [h.id]: !p[h.id] }))}
              />
              <HullThumb thumbUrl={h.thumbUrl} sticker={h.sticker} craftType={h.craftType} size={32} />
              <span className="text-lg font-bold tabular-nums text-bay-700 dark:text-bay-400">
                #{h.sticker}
              </span>
              <span className="text-slate-600 dark:text-slate-300">{h.craftType}</span>
              {h.onWater && <span className="ml-auto text-xs text-slate-400">on the water</span>}
            </label>
          </li>
        ))}
        {hulls.length === 0 && (
          <li className="text-sm text-slate-400">No available watercraft to launch.</li>
        )}
      </ul>

      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={launch}
          disabled={pending || ids.length === 0}
          className="flex-1 rounded-xl bg-bay-600 px-5 py-3 font-semibold text-white hover:bg-bay-700 disabled:opacity-50"
        >
          {pending ? 'Working…' : 'Launch'}
        </button>
        <button
          onClick={pass}
          disabled={pending}
          className="rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Pass
        </button>
      </div>
    </section>
  );
}
