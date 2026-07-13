import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { MemberForm } from '@/components/MemberForm';

export const dynamic = 'force-dynamic';

// Household member management (§7). Household-scoped — the primary adds their own
// spouse/kids; not an admin task.
export default async function HouseholdPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/household');
  const member = await getCurrentMember();
  if (!member) redirect('/checkin');

  const { data: members } = await supabase
    .from('members')
    .select('id, first_name, last_name, email, mobile, role, birth_year, supervision_only')
    .eq('household_id', member.householdId)
    .order('role')
    .order('first_name');

  const thisYear = new Date().getFullYear();

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-bay-700 dark:text-bay-500">Household</h1>
          <p className="text-sm text-slate-500">{member.householdName}</p>
        </div>
        <Link href="/checkin" className="text-sm text-bay-700 dark:text-bay-500">
          Check in →
        </Link>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
          Members
        </h2>
        <ul className="flex flex-col gap-2">
          {(members ?? []).map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800"
            >
              <span>
                {m.first_name} {m.last_name}
                {m.role === 'primary' && (
                  <span className="ml-2 rounded bg-bay-100 px-1.5 text-xs text-bay-800 dark:bg-slate-800 dark:text-bay-300">
                    primary
                  </span>
                )}
                {m.supervision_only && (
                  <span className="ml-2 text-xs text-amber-600">supervision only</span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {m.birth_year ? `~${thisYear - m.birth_year} yrs` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
          Add a member
        </h2>
        <MemberForm />
      </section>
    </main>
  );
}
