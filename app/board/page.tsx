import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getBoard, type LakeBoard } from '@/lib/board';
import { HullThumb } from '@/components/HullThumb';

// The live board is association-public but requires sign-in (§6). Auto-refresh via
// a client-side poll would go here; for now it revalidates on navigation and after
// any action. force-dynamic because it reads live state.
export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/board');

  const boards = await getBoard();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-bay-700 dark:text-bay-500">Lake Status</h1>
      <div className="flex flex-col gap-8">
        {boards.map((lake) => (
          <LakeCard key={lake.id} lake={lake} />
        ))}
      </div>
    </main>
  );
}

function LakeCard({ lake }: { lake: LakeBoard }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">{lake.name}</h2>
        <span className="text-sm text-slate-500">
          {lake.openHulls} of {lake.capacity} in use
        </span>
      </header>

      {lake.sessions.length === 0 && (
        <p className="text-sm text-slate-400">No one on the water.</p>
      )}

      <ul className="flex flex-col gap-3">
        {lake.sessions.map((s) => (
          <li
            key={s.id}
            className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.householdName}</span>
              <span className="text-xs text-slate-500">
                {s.startedClock}
                {s.endsClock ? ` → ${s.endsClock}` : ''}
                {s.lastCall ? ' · last call' : ''}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {s.hulls.map((h) => (
                <span
                  key={h.sticker}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-sm shadow-sm dark:bg-slate-800"
                  title={h.craftType}
                >
                  {/* Tap the photo to enlarge — this is the enforcement match (§6) */}
                  <HullThumb
                    thumbUrl={h.thumbUrl}
                    photoUrl={h.photoUrl}
                    sticker={h.sticker}
                    craftType={h.craftType}
                    householdName={s.householdName}
                    size={44}
                    enlargeable
                  />
                  {/* Sticker number is the enforcement hero (§6) */}
                  <strong className="text-lg tabular-nums text-bay-700 dark:text-bay-400">
                    #{h.sticker}
                  </strong>
                  <span className="text-slate-500">{h.craftType}</span>
                  {h.isGuest && (
                    <span className="rounded bg-amber-100 px-1 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      guest{h.guestName ? ` · ${h.guestName}` : ''}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {lake.queue.length > 0 && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          <h3 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">
            Queue
          </h3>
          <ol className="text-sm text-slate-600 dark:text-slate-400">
            {lake.queue.map((q) => (
              <li key={q.position}>
                #{q.position} {q.householdName}
                {q.offered ? ' · offered' : ''}
              </li>
            ))}
          </ol>
          {lake.sessionsAheadEndClocks.length > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              Sessions ahead end at {lake.sessionsAheadEndClocks.join(', ')}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
