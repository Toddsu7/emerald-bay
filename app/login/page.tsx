'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Magic link only — no passwords, ever (§7).
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setStatus('error');
      setMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold text-bay-700 dark:text-bay-500">Sign in</h1>
      {status === 'sent' ? (
        <p className="rounded-lg bg-bay-50 p-4 text-bay-800 dark:bg-slate-900 dark:text-bay-100">
          Check your email for a sign-in link.
        </p>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-3">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            className="rounded-xl bg-bay-600 px-5 py-3 font-semibold text-white hover:bg-bay-700 disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Send magic link'}
          </button>
          {status === 'error' && <p className="text-sm text-red-600">{message}</p>}
        </form>
      )}
      <p className="text-xs text-slate-400">
        We&apos;ll email you a one-time link. No password to remember.
      </p>
    </main>
  );
}
