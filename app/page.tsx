import Link from 'next/link';

// Landing / entry. The real surfaces (check-in, board, admin) come with auth.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-bay-700 dark:text-bay-500">
          Emerald Bay
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Lake access &amp; check-in for East and West.
        </p>
      </header>

      <nav className="flex flex-col gap-3">
        <Link
          href="/board"
          className="rounded-xl bg-bay-600 px-5 py-3 text-center font-semibold text-white hover:bg-bay-700"
        >
          Lake Status
        </Link>
        <Link
          href="/login"
          className="rounded-xl border border-bay-600 px-5 py-3 text-center font-semibold text-bay-700 hover:bg-bay-50 dark:text-bay-500 dark:hover:bg-slate-900"
        >
          Sign in
        </Link>
      </nav>

      <p className="text-xs text-slate-400">
        Any watercraft making a wake on East or West must be checked in. E-Foils
        and craft puttering inside the buoy line do not check in.
      </p>
    </main>
  );
}
