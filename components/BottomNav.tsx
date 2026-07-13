'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Persistent bottom navigation (§ nav dead-end fix). Reach Check-in, Lake Status,
// My Watercraft, and Household in one tap from anywhere — a member on the water can
// always get back to their Check Out.
const TABS = [
  { href: '/checkin', label: 'Check-in' },
  { href: '/board', label: 'Lake Status' },
  { href: '/hulls', label: 'My Watercraft' },
  { href: '/household', label: 'Household' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      {TABS.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex-1 py-2.5 text-center text-xs ${
              active
                ? 'font-semibold text-bay-700 dark:text-bay-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
