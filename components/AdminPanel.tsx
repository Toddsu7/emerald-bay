'use client';

import { useState, useTransition } from 'react';
import {
  confirmViolation,
  dismissViolation,
  adminEndSession,
  liftSuspension,
  updateScheduleRow,
} from '@/lib/actions/admin';
import { chicagoClock } from '@/lib/sun';

export interface AdminData {
  violations: {
    id: string;
    householdName: string;
    track: string;
    kind: string;
    detectedAt: string;
  }[];
  sessions: {
    id: string;
    householdName: string;
    lakeName: string;
    lastCall: boolean;
    stickers: number[];
  }[];
  schedule: {
    track: string;
    offenseNumber: number;
    fineAmount: number | null;
    suspensionDays: number | null;
    note: string | null;
  }[];
  suspended: {
    id: string;
    name: string;
    status: string;
    suspendedUntil: string | null;
  }[];
}

export function AdminPanel({ data }: { data: AdminData }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');

  function run(p: Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = await p;
      setMsg(res.ok ? 'Done.' : res.error ?? 'Error');
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {msg && <p className="text-sm text-bay-700 dark:text-bay-400">{msg}</p>}

      {/* Flagged violations — human review, never auto-fine (§2.8/§13) */}
      <section>
        <h2 className="mb-2 font-semibold">Flagged violations</h2>
        {data.violations.length === 0 && (
          <p className="text-sm text-slate-400">Nothing awaiting review.</p>
        )}
        <ul className="flex flex-col gap-2">
          {data.violations.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"
            >
              <span>
                <strong>{v.householdName}</strong> · {v.track}/{v.kind} ·{' '}
                {chicagoClock(new Date(v.detectedAt))}
              </span>
              <span className="flex gap-2">
                <button
                  onClick={() => run(confirmViolation({ id: v.id }))}
                  disabled={pending}
                  className="rounded bg-bay-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Confirm (apply schedule)
                </button>
                <button
                  onClick={() => run(dismissViolation(v.id))}
                  disabled={pending}
                  className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
                >
                  Dismiss
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Open sessions — admin override / void */}
      <section>
        <h2 className="mb-2 font-semibold">On the water</h2>
        <ul className="flex flex-col gap-2">
          {data.sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"
            >
              <span>
                {s.lakeName} · <strong>{s.householdName}</strong> ·{' '}
                {s.stickers.map((n) => `#${n}`).join(', ')}
                {s.lastCall && <span className="ml-2 text-amber-600">last call</span>}
              </span>
              <button
                onClick={() => run(adminEndSession(s.id))}
                disabled={pending}
                className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-400"
              >
                Force end
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Suspended households */}
      {data.suspended.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Suspended households</h2>
          <ul className="flex flex-col gap-2">
            {data.suspended.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"
              >
                <span>
                  <strong>{h.name}</strong>
                  {h.suspendedUntil
                    ? ` · until ${new Date(h.suspendedUntil).toLocaleDateString()}`
                    : ' · indefinite'}
                </span>
                <button
                  onClick={() => run(liftSuspension(h.id))}
                  disabled={pending}
                  className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
                >
                  Lift
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Violation schedule — board-editable config (§12.1) */}
      <section>
        <h2 className="mb-2 font-semibold">Violation schedule</h2>
        <p className="mb-2 text-xs text-slate-500">
          Board-editable. Todd&apos;s dollar amounts are preloaded; the rules doc says
          the app-usage track is suspension-only with no dollars — the board picks.
        </p>
        <div className="flex flex-col gap-2">
          {data.schedule.map((r) => (
            <ScheduleRow key={`${r.track}-${r.offenseNumber}`} row={r} onSave={run} pending={pending} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ScheduleRow({
  row,
  onSave,
  pending,
}: {
  row: AdminData['schedule'][number];
  onSave: (p: Promise<{ ok: boolean; error?: string }>) => void;
  pending: boolean;
}) {
  const [fine, setFine] = useState(row.fineAmount?.toString() ?? '');
  const [days, setDays] = useState(row.suspensionDays?.toString() ?? '');
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
      <span className="w-40 shrink-0">
        {row.track} · #{row.offenseNumber}
      </span>
      <label className="flex items-center gap-1">
        $
        <input
          value={fine}
          onChange={(e) => setFine(e.target.value)}
          placeholder="—"
          className="w-16 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
        />
      </label>
      <label className="flex items-center gap-1">
        <input
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder="—"
          className="w-14 rounded border border-slate-300 px-1 dark:border-slate-700 dark:bg-slate-900"
        />
        days
      </label>
      <button
        onClick={() =>
          onSave(
            updateScheduleRow({
              track: row.track,
              offenseNumber: row.offenseNumber,
              fineAmount: fine === '' ? null : Number(fine),
              suspensionDays: days === '' ? null : Number(days),
            }),
          )
        }
        disabled={pending}
        className="ml-auto rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        Save
      </button>
    </div>
  );
}
