'use client';

import { useMemo, useState, useTransition } from 'react';
import { checkInAction, endSessionAction, type HullSelection } from '@/lib/actions/checkin';
import { joinQueueAction } from '@/lib/actions/queue';
import { lakeStatusMessage } from '@/lib/caps';

export interface FormLake {
  id: string;
  name: string;
  slots: number;
  cap: number;
  householdsWaiting: number;
}
export interface FormHull {
  id: string;
  sticker: number;
  craftType: string;
  onWater: boolean;
}
export interface FormSession {
  id: string;
  lakeName: string;
  lastCall: boolean;
  stickers: number[];
}

interface Selection {
  isGuest: boolean;
  guestName: string;
}

export function CheckInForm({
  lakes,
  hulls,
  mySessions,
}: {
  lakes: FormLake[];
  hulls: FormHull[];
  mySessions: FormSession[];
}) {
  const [lakeId, setLakeId] = useState(lakes[0]?.id ?? '');
  const [selected, setSelected] = useState<Record<string, Selection>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, startTransition] = useTransition();

  const lake = useMemo(() => lakes.find((l) => l.id === lakeId), [lakes, lakeId]);
  const selectedIds = Object.keys(selected);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { isGuest: false, guestName: '' };
      return next;
    });
  }

  function setGuest(id: string, isGuest: boolean) {
    setSelected((prev) => ({ ...prev, [id]: { ...prev[id], isGuest } }));
  }
  function setGuestName(id: string, guestName: string) {
    setSelected((prev) => ({ ...prev, [id]: { ...prev[id], guestName } }));
  }

  function reset() {
    setSelected({});
  }

  function doCheckIn() {
    setError('');
    setNotice('');
    const payload: HullSelection[] = selectedIds.map((id) => ({
      watercraftId: id,
      isGuestOperated: selected[id].isGuest,
      guestName: selected[id].guestName || null,
    }));
    startTransition(async () => {
      const res = await checkInAction({ lakeId, hulls: payload });
      if (res.ok) {
        setNotice('Checked in.');
        reset();
      } else {
        setError(res.error);
      }
    });
  }

  function doJoinQueue() {
    setError('');
    setNotice('');
    startTransition(async () => {
      const res = await joinQueueAction(lakeId);
      if (res.ok) setNotice('You’re in the queue. Watch for a LAUNCH offer.');
      else setError(res.error);
    });
  }

  function doCheckOut(sessionId: string) {
    setError('');
    setNotice('');
    startTransition(async () => {
      const res = await endSessionAction(sessionId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Household's active sessions */}
      {mySessions.length > 0 && (
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            On the water now
          </h2>
          <ul className="flex flex-col gap-2">
            {mySessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span>
                  {s.lakeName}: {s.stickers.map((n) => `#${n}`).join(', ')}
                  {s.lastCall && (
                    <span className="ml-2 text-amber-600">last call</span>
                  )}
                </span>
                <button
                  onClick={() => doCheckOut(s.id)}
                  disabled={pending}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-900"
                >
                  Check out
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Lake picker */}
      <div className="flex gap-2">
        {lakes.map((l) => (
          <button
            key={l.id}
            onClick={() => setLakeId(l.id)}
            className={`flex-1 rounded-xl border px-4 py-3 text-center ${
              l.id === lakeId
                ? 'border-bay-600 bg-bay-50 dark:bg-slate-900'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <div className="font-semibold">{l.name}</div>
            <div className="text-xs text-slate-500">{l.slots} open</div>
          </button>
        ))}
      </div>

      {lake && (
        <p
          className={`rounded-lg p-3 text-sm ${
            lake.householdsWaiting > 0
              ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300'
          }`}
        >
          {lakeStatusMessage({
            cap: lake.cap,
            slots: lake.slots,
            householdsWaiting: lake.householdsWaiting,
          })}
        </p>
      )}

      {/* Hull selection */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
          Your watercraft
        </h2>
        {hulls.length === 0 && (
          <p className="text-sm text-slate-400">
            No checkinable watercraft registered to your household.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {hulls.map((h) => {
            const sel = selected[h.id];
            return (
              <li
                key={h.id}
                className={`rounded-xl border p-3 ${
                  sel ? 'border-bay-600' : 'border-slate-200 dark:border-slate-800'
                } ${h.onWater ? 'opacity-50' : ''}`}
              >
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    disabled={h.onWater}
                    checked={!!sel}
                    onChange={() => toggle(h.id)}
                  />
                  <span className="text-lg font-bold tabular-nums text-bay-700 dark:text-bay-400">
                    #{h.sticker}
                  </span>
                  <span className="text-slate-600 dark:text-slate-300">{h.craftType}</span>
                  {h.onWater && <span className="ml-auto text-xs text-slate-400">on the water</span>}
                </label>
                {sel && (
                  <div className="mt-2 flex flex-col gap-2 pl-8">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={sel.isGuest}
                        onChange={(e) => setGuest(h.id, e.target.checked)}
                      />
                      Guest-operated
                    </label>
                    {sel.isGuest && (
                      <>
                        <input
                          type="text"
                          placeholder="Guest name (optional)"
                          value={sel.guestName}
                          onChange={(e) => setGuestName(h.id, e.target.value)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                        />
                        {/* Acknowledgment sits with the hull it applies to, at the
                            moment of the decision (§8). */}
                        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          You are responsible for your guest&apos;s compliance with
                          all lake rules. Violations will be recorded against your
                          household.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-bay-700 dark:text-bay-400">{notice}</p>}

      <div className="flex gap-2">
        <button
          onClick={doCheckIn}
          disabled={pending || selectedIds.length === 0}
          className="flex-1 rounded-xl bg-bay-600 px-5 py-3 font-semibold text-white hover:bg-bay-700 disabled:opacity-50"
        >
          {pending ? 'Working…' : `Check in ${selectedIds.length || ''}`.trim()}
        </button>
        <button
          onClick={doJoinQueue}
          disabled={pending}
          className="rounded-xl border border-bay-600 px-5 py-3 font-semibold text-bay-700 hover:bg-bay-50 disabled:opacity-50 dark:text-bay-500 dark:hover:bg-slate-900"
        >
          Join queue
        </button>
      </div>
    </div>
  );
}
