import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentMember } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PhotoUpload } from '@/components/PhotoUpload';

export const dynamic = 'force-dynamic';

// Household's watercraft + photo upload (§8, §10). Photos make the public board
// worth having — prompt for them.
export default async function HullsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/hulls');
  const member = await getCurrentMember();
  if (!member) redirect('/checkin');

  const { data: hulls } = await supabase
    .from('watercraft')
    .select('id, sticker_number, craft_type, is_checkinable, photo_url')
    .eq('household_id', member.householdId)
    .order('sticker_number');

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bay-700 dark:text-bay-500">Your watercraft</h1>
        <Link href="/checkin" className="text-sm text-bay-700 dark:text-bay-500">
          Check in →
        </Link>
      </header>
      <p className="mb-4 text-sm text-slate-500">
        Please upload a clean photo of your boat on the water with the sticker
        showing. Take it from the side so the sticker is clearly readable.
      </p>
      <ul className="flex flex-col gap-4">
        {(hulls ?? []).map((h) => (
          <li key={h.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <strong className="text-xl tabular-nums text-bay-700 dark:text-bay-400">
                #{h.sticker_number}
              </strong>
              <span className="text-slate-600 dark:text-slate-300">{h.craft_type}</span>
              {!h.is_checkinable && (
                <span className="ml-auto rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                  not checkinable
                </span>
              )}
            </div>
            {h.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={h.photo_url}
                alt={`#${h.sticker_number}`}
                className="mt-3 max-h-40 rounded-lg object-cover"
              />
            )}
            <PhotoUpload watercraftId={h.id} hasPhoto={!!h.photo_url} />
          </li>
        ))}
      </ul>
    </main>
  );
}
