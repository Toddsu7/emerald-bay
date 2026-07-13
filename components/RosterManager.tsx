'use client';

import { useState, useTransition } from 'react';
import { CRAFT_TYPES, type CraftType } from '@/lib/types';
import {
  searchHouseholds,
  getHouseholdDetail,
  adminAddMember,
  adminUpdateMember,
  adminSetMemberActive,
  resendInvite,
  adminAddWatercraft,
  adminUpdateWatercraft,
  adminTransferWatercraft,
  type HouseholdSearchResult,
  type HouseholdDetail,
  type RosterMember,
  type RosterHull,
  type MemberInput,
  type HullInput,
  type RosterViolation,
} from '@/lib/actions/adminRoster';
import {
  suspendHousehold,
  liftSuspension,
  updateHouseholdNotes,
  createViolation,
} from '@/lib/actions/admin';
import { BOARD_VIOLATION_TYPES } from '@/lib/violations';

const inputCls =
  'rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900';

export function RosterManager() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HouseholdSearchResult[]>([]);
  const [detail, setDetail] = useState<HouseholdDetail | null>(null);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();

  function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setMsg('');
    start(async () => {
      const res = await searchHouseholds(query);
      if (res.ok) setResults(res.data ?? []);
      else setMsg(res.error);
    });
  }

  function open(id: string) {
    setMsg('');
    start(async () => {
      const res = await getHouseholdDetail(id);
      if (res.ok && res.data) setDetail(res.data);
      else if (!res.ok) setMsg(res.error);
    });
  }

  function refresh() {
    if (detail) open(detail.id);
  }

  function report(p: Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const r = await p;
      setMsg(r.ok ? r.message ?? 'Done.' : r.error ?? 'Error');
      if (r.ok) refresh();
    });
  }

  return (
    <section>
      <h2 className="mb-2 font-semibold">Roster management</h2>
      {msg && <p className="mb-2 text-sm text-bay-700 dark:text-bay-400">{msg}</p>}

      <form onSubmit={runSearch} className="mb-3 flex gap-2">
        <input
          className={`${inputCls} flex-1`}
          placeholder="Search households by name or address"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-bay-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {!detail && (
        <ul className="flex flex-col gap-1">
          {results.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => open(h.id)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-2 text-left text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
              >
                <span>
                  <strong>{h.name}</strong>
                  {h.address ? <span className="text-slate-400"> · {h.address}</span> : null}
                </span>
                <span className="text-xs text-slate-400">
                  {h.memberCount} members · {h.hullCount} hulls
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="text-sm text-slate-400">No results — search above.</li>
          )}
        </ul>
      )}

      {detail && (
        <HouseholdCard detail={detail} onBack={() => setDetail(null)} onAction={report} pending={pending} />
      )}
    </section>
  );
}

function HouseholdCard({
  detail,
  onBack,
  onAction,
  pending,
}: {
  detail: HouseholdDetail;
  onBack: () => void;
  onAction: (p: Promise<{ ok: boolean; error?: string; message?: string }>) => void;
  pending: boolean;
}) {
  const [addingMember, setAddingMember] = useState(false);
  const [editMember, setEditMember] = useState<string | null>(null);
  const [addingHull, setAddingHull] = useState(false);
  const [editHull, setEditHull] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{detail.name}</h3>
          {detail.address && <p className="text-xs text-slate-400">{detail.address}</p>}
        </div>
        <button onClick={onBack} className="text-sm text-bay-700 dark:text-bay-500">
          ← results
        </button>
      </div>

      <SuspendControl detail={detail} onAction={onAction} pending={pending} />
      <NotesEditor
        key={`notes-${detail.notes ?? ''}`}
        householdId={detail.id}
        initial={detail.notes ?? ''}
        onAction={onAction}
        pending={pending}
      />

      {/* Members */}
      <h4 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Members</h4>
      <ul className="mb-2 flex flex-col gap-1">
        {detail.members.map((m) =>
          editMember === m.id ? (
            <li key={m.id}>
              <MemberForm
                initial={m}
                onCancel={() => setEditMember(null)}
                onSubmit={(input) => {
                  onAction(adminUpdateMember(m.id, input));
                  setEditMember(null);
                }}
                pending={pending}
              />
            </li>
          ) : (
            <li
              key={m.id}
              className={`flex items-center justify-between rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800 ${
                m.active ? '' : 'opacity-50'
              }`}
            >
              <span>
                {m.firstName} {m.lastName}
                <span className="text-xs text-slate-400">
                  {' '}
                  · {m.role}
                  {m.isAdmin ? ' · admin' : ''}
                  {m.age != null ? ` · ${m.age}y` : ''}
                  {!m.active ? ' · inactive' : ''}
                </span>
              </span>
              <span className="flex gap-1">
                <MiniBtn onClick={() => setEditMember(m.id)}>Edit</MiniBtn>
                {m.email && <MiniBtn onClick={() => onAction(resendInvite(m.id))}>Invite</MiniBtn>}
                <MiniBtn onClick={() => onAction(adminSetMemberActive(m.id, !m.active))}>
                  {m.active ? 'Deactivate' : 'Reactivate'}
                </MiniBtn>
              </span>
            </li>
          ),
        )}
      </ul>
      {addingMember ? (
        <MemberForm
          onCancel={() => setAddingMember(false)}
          onSubmit={(input) => {
            onAction(adminAddMember(detail.id, input));
            setAddingMember(false);
          }}
          pending={pending}
        />
      ) : (
        <MiniBtn onClick={() => setAddingMember(true)}>+ Add member</MiniBtn>
      )}

      {/* Watercraft */}
      <h4 className="mb-1 mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
        Watercraft
      </h4>
      <ul className="mb-2 flex flex-col gap-1">
        {detail.hulls.map((w) =>
          editHull === w.id ? (
            <li key={w.id}>
              <HullForm
                initial={w}
                onCancel={() => setEditHull(null)}
                onSubmit={(input) => {
                  onAction(adminUpdateWatercraft(w.id, input));
                  setEditHull(null);
                }}
                onTransfer={(target) => {
                  onAction(adminTransferWatercraft(w.id, target));
                  setEditHull(null);
                }}
                pending={pending}
              />
            </li>
          ) : (
            <li
              key={w.id}
              className={`flex items-center justify-between rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800 ${
                w.active ? '' : 'opacity-50'
              }`}
            >
              <span>
                <strong className="tabular-nums text-bay-700 dark:text-bay-400">#{w.sticker}</strong>{' '}
                {w.craftType}
                <span className="text-xs text-slate-400">
                  {w.manufacturer ? ` · ${w.manufacturer}` : ''}
                  {w.isCheckinable ? '' : ' · not checkinable'}
                  {!w.active ? ' · inactive' : ''}
                </span>
              </span>
              <MiniBtn onClick={() => setEditHull(w.id)}>Edit</MiniBtn>
            </li>
          ),
        )}
      </ul>
      {addingHull ? (
        <HullForm
          onCancel={() => setAddingHull(false)}
          onSubmit={(input) => {
            onAction(adminAddWatercraft(detail.id, input));
            setAddingHull(false);
          }}
          pending={pending}
        />
      ) : (
        <MiniBtn onClick={() => setAddingHull(true)}>+ Add watercraft</MiniBtn>
      )}

      {/* Violation history — is this their 1st or their 4th? */}
      <h4 className="mb-1 mt-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
        Violation history
      </h4>
      <ViolationHistory violations={detail.violations} />
      <AddViolationForm householdId={detail.id} onAction={onAction} pending={pending} />
    </div>
  );
}

function SuspendControl({
  detail,
  onAction,
  pending,
}: {
  detail: HouseholdDetail;
  onAction: (p: Promise<{ ok: boolean; error?: string; message?: string }>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [untilDate, setUntilDate] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const suspended =
    detail.status === 'suspended' ||
    (detail.suspendedUntil != null && new Date(detail.suspendedUntil) > new Date());

  return (
    <div className="mb-3 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-800">
      {suspended ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-red-700 dark:text-red-400">
            Suspended
            {detail.suspendedUntil
              ? ` until ${new Date(detail.suspendedUntil).toLocaleDateString()}`
              : ''}
            {detail.suspendedReason ? ` · ${detail.suspendedReason}` : ''}
          </span>
          <MiniBtn onClick={() => onAction(liftSuspension(detail.id))}>Lift</MiniBtn>
        </div>
      ) : open ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              Until
              <input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className={inputCls} />
            </label>
            <span className="text-xs text-slate-400">or</span>
            <label className="flex items-center gap-1 text-xs">
              <input type="number" value={days} onChange={(e) => setDays(e.target.value)} placeholder="#" className={`${inputCls} w-16`} />
              days
            </label>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              disabled={pending}
              onClick={() =>
                onAction(
                  suspendHousehold({
                    householdId: detail.id,
                    untilDate: untilDate || undefined,
                    days: days === '' ? undefined : Number(days),
                    reason,
                  }),
                )
              }
              className="rounded bg-red-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Suspend
            </button>
            <MiniBtn onClick={() => setOpen(false)}>Cancel</MiniBtn>
          </div>
        </div>
      ) : (
        <MiniBtn onClick={() => setOpen(true)}>Suspend household…</MiniBtn>
      )}
    </div>
  );
}

function NotesEditor({
  householdId,
  initial,
  onAction,
  pending,
}: {
  householdId: string;
  initial: string;
  onAction: (p: Promise<{ ok: boolean; error?: string; message?: string }>) => void;
  pending: boolean;
}) {
  const [notes, setNotes] = useState(initial);
  return (
    <div className="mb-3">
      <h4 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Notes</h4>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Board notes on this household…"
        className={`${inputCls} w-full`}
      />
      {notes !== initial && (
        <MiniBtn onClick={() => onAction(updateHouseholdNotes(householdId, notes))}>
          {pending ? 'Saving…' : 'Save notes'}
        </MiniBtn>
      )}
    </div>
  );
}

function ViolationHistory({ violations }: { violations: RosterViolation[] }) {
  if (violations.length === 0) {
    return <p className="text-sm text-slate-400">No violations on record.</p>;
  }
  const statusColor: Record<string, string> = {
    flagged: 'text-amber-700 dark:text-amber-500',
    confirmed: 'text-red-700 dark:text-red-400',
    dismissed: 'text-slate-400',
  };
  return (
    <ul className="mb-2 flex flex-col gap-1">
      {violations.map((v) => (
        <li key={v.id} className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span>
              {new Date(v.detectedAt).toLocaleDateString()} · {v.track}/{v.kind}
            </span>
            <span className={`font-medium ${statusColor[v.status] ?? ''}`}>{v.status}</span>
          </div>
          {(v.fineAmount != null || v.suspensionDays != null || v.notes) && (
            <div className="mt-0.5 text-slate-500">
              {v.fineAmount != null ? `$${v.fineAmount}` : ''}
              {v.suspensionDays ? ` · ${v.suspensionDays}-day suspension` : ''}
              {v.notes ? ` · ${v.notes}` : ''}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddViolationForm({
  householdId,
  onAction,
  pending,
}: {
  householdId: string;
  onAction: (p: Promise<{ ok: boolean; error?: string; message?: string }>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [notes, setNotes] = useState('');
  if (!open) return <MiniBtn onClick={() => setOpen(true)}>+ Record a violation</MiniBtn>;
  const type = BOARD_VIOLATION_TYPES[idx];
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-bay-400 p-2 dark:border-bay-700">
      <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className={inputCls}>
        {BOARD_VIOLATION_TYPES.map((t, i) => (
          <option key={t.kind} value={i}>
            {t.label}
          </option>
        ))}
      </select>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What happened (recorded)"
        className={inputCls}
      />
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() => {
            onAction(
              createViolation({
                householdId,
                track: type.track,
                kind: type.kind,
                notes: notes || undefined,
              }),
            );
            setOpen(false);
            setNotes('');
          }}
          className="rounded bg-bay-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Record (flag for review)
        </button>
        <MiniBtn onClick={() => setOpen(false)}>Cancel</MiniBtn>
      </div>
    </div>
  );
}

function MiniBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
    >
      {children}
    </button>
  );
}

function MemberForm({
  initial,
  onSubmit,
  onCancel,
  pending,
}: {
  initial?: RosterMember;
  onSubmit: (input: MemberInput) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [f, setF] = useState({
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    email: initial?.email ?? '',
    mobile: initial?.mobile ?? '',
    age: initial?.age?.toString() ?? '',
    role: initial?.role ?? ('member' as 'primary' | 'member'),
    isAdmin: initial?.isAdmin ?? false,
  });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-bay-400 p-2 dark:border-bay-700">
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="First" value={f.firstName} onChange={(e) => set('firstName', e.target.value)} />
        <input className={`${inputCls} flex-1`} placeholder="Last" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
      </div>
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="Email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        <input className={`${inputCls} flex-1`} placeholder="Mobile" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <input className={`${inputCls} w-16`} type="number" placeholder="Age" value={f.age} onChange={(e) => set('age', e.target.value)} />
        <select className={inputCls} value={f.role} onChange={(e) => set('role', e.target.value)}>
          <option value="member">member</option>
          <option value="primary">primary</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={f.isAdmin} onChange={(e) => set('isAdmin', e.target.checked)} />
          admin
        </label>
      </div>
      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={() =>
            onSubmit({
              firstName: f.firstName,
              lastName: f.lastName,
              email: f.email || null,
              mobile: f.mobile || null,
              age: f.age === '' ? null : Number(f.age),
              role: f.role,
              isAdmin: f.isAdmin,
            })
          }
          className="rounded bg-bay-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {initial ? 'Save' : 'Add'}
        </button>
        <MiniBtn onClick={onCancel}>Cancel</MiniBtn>
      </div>
    </div>
  );
}

function HullForm({
  initial,
  onSubmit,
  onCancel,
  onTransfer,
  pending,
}: {
  initial?: RosterHull;
  onSubmit: (input: HullInput) => void;
  onCancel: () => void;
  onTransfer?: (targetHouseholdId: string) => void;
  pending: boolean;
}) {
  const [f, setF] = useState({
    sticker: initial?.sticker?.toString() ?? '',
    craftType: initial?.craftType ?? ('Pontoon' as CraftType),
    manufacturer: initial?.manufacturer ?? '',
    model: initial?.model ?? '',
    active: initial?.active ?? true,
  });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const [transferring, setTransferring] = useState(false);
  const [tResults, setTResults] = useState<HouseholdSearchResult[]>([]);
  const [tQuery, setTQuery] = useState('');
  const [, startT] = useTransition();

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-bay-400 p-2 dark:border-bay-700">
      <div className="flex gap-2">
        <input className={`${inputCls} w-20`} type="number" placeholder="Sticker" value={f.sticker} onChange={(e) => set('sticker', e.target.value)} />
        <select className={inputCls} value={f.craftType} onChange={(e) => set('craftType', e.target.value)}>
          {CRAFT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />
          active
        </label>
      </div>
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="Manufacturer" value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
        <input className={`${inputCls} flex-1`} placeholder="Model" value={f.model} onChange={(e) => set('model', e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={pending}
          onClick={() =>
            onSubmit({
              sticker: Number(f.sticker),
              craftType: f.craftType,
              manufacturer: f.manufacturer || null,
              model: f.model || null,
              active: f.active,
            })
          }
          className="rounded bg-bay-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {initial ? 'Save' : 'Add'}
        </button>
        {initial && onTransfer && <MiniBtn onClick={() => setTransferring((v) => !v)}>Transfer…</MiniBtn>}
        <MiniBtn onClick={onCancel}>Cancel</MiniBtn>
      </div>

      {transferring && onTransfer && (
        <div className="flex flex-col gap-1 border-t border-slate-200 pt-2 dark:border-slate-800">
          <div className="flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              placeholder="Search target household"
              value={tQuery}
              onChange={(e) => setTQuery(e.target.value)}
            />
            <MiniBtn
              onClick={() =>
                startT(async () => {
                  const res = await searchHouseholds(tQuery);
                  if (res.ok) setTResults(res.data ?? []);
                })
              }
            >
              Find
            </MiniBtn>
          </div>
          <ul className="flex flex-col gap-1">
            {tResults.map((h) => (
              <li key={h.id}>
                <MiniBtn onClick={() => onTransfer(h.id)}>→ {h.name}</MiniBtn>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
