'use client';

import { useState, useTransition } from 'react';
import { addMember } from '@/lib/actions/members';
import { ageBand } from '@/lib/agegate';

export function MemberForm() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [age, setAge] = useState('');
  const [boaterEd, setBoaterEd] = useState(false);
  const [supervisionOnly, setSupervisionOnly] = useState(false);
  const [liabilityAck, setLiabilityAck] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();

  const ageNum = Number(age);
  const band = age !== '' && Number.isFinite(ageNum) ? ageBand(ageNum) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setMsg('');
    start(async () => {
      const res = await addMember({
        firstName,
        lastName,
        email: email || undefined,
        mobile: mobile || undefined,
        age: ageNum,
        boaterEdAttested: boaterEd,
        supervisionOnly,
        liabilityAck,
      });
      if (res.ok) {
        setMsg(res.message ?? 'Added.');
        setFirstName('');
        setLastName('');
        setEmail('');
        setMobile('');
        setAge('');
        setBoaterEd(false);
        setSupervisionOnly(false);
        setLiabilityAck(false);
      } else {
        setErr(res.error);
      }
    });
  }

  const input =
    'rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900';

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input className={`${input} flex-1`} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <input className={`${input} flex-1`} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      </div>
      <input className={input} type="email" placeholder="Email (for their sign-in link)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className={input} type="tel" placeholder="Mobile (optional)" value={mobile} onChange={(e) => setMobile(e.target.value)} />
      <input className={input} type="number" min={0} max={120} placeholder="Age" value={age} onChange={(e) => setAge(e.target.value)} required />

      {band === 'under12' && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Under 12 can’t be registered as an operator (Kansas law).
        </p>
      )}

      {band === '12-20' && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-amber-300 p-3 dark:border-amber-800">
          <legend className="px-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
            Ages 12–20 — Kansas requirement
          </legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={boaterEd} onChange={(e) => { setBoaterEd(e.target.checked); if (e.target.checked) setSupervisionOnly(false); }} />
            Holds a Kansas boater-education certificate
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={supervisionOnly} onChange={(e) => { setSupervisionOnly(e.target.checked); if (e.target.checked) setBoaterEd(false); }} />
            Will operate only under direct, on-board supervision of an adult 21+ (or certified 18+)
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={liabilityAck} onChange={(e) => setLiabilityAck(e.target.checked)} />
            I acknowledge liability for this operator’s compliance with all lake rules.
          </label>
        </fieldset>
      )}

      {err && <p className="text-sm text-red-600">{err}</p>}
      {msg && <p className="text-sm text-bay-700 dark:text-bay-400">{msg}</p>}

      <button
        type="submit"
        disabled={pending || band === 'under12'}
        className="rounded-xl bg-bay-600 px-5 py-3 font-semibold text-white hover:bg-bay-700 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add member & send invite'}
      </button>
    </form>
  );
}
