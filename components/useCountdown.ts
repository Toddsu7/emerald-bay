'use client';

import { useEffect, useState } from 'react';

// Live MM:SS countdown to an ISO instant. Starts null on the server/first render to
// avoid a hydration mismatch, then ticks every second on the client.
export function useCountdown(expiresAtIso: string | null): {
  label: string;
  expired: boolean;
  ready: boolean;
} {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const target = expiresAtIso ? new Date(expiresAtIso).getTime() : null;
  if (now === null || target === null) return { label: '', expired: false, ready: false };
  const ms = Math.max(0, target - now);
  const sec = Math.floor(ms / 1000);
  return {
    label: `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`,
    expired: ms <= 0,
    ready: true,
  };
}
