// Session timing (rules doc: "a 1-hour continuous use time limit immediately
// followed by at least a 1-hour non-use period" — continuous from the start of use).
//
// Hours run continuously in 1-hour blocks from started_at. The block boundary is a
// PURE function of started_at — never reset, never extended by someone else joining
// the queue. There is NO grace floor. At each boundary the queue is evaluated: no
// one waiting → auto-renew; someone waiting → end at that boundary + cooldown.

export const HOUR_MS = 60 * 60 * 1000;
export const SIXTY_MIN_MS = 60 * 60 * 1000; // household cooldown / non-use period
export const TEN_MIN_MS = 10 * 60 * 1000; // queue offer hold (§2.7) — separate concept

/**
 * The end of the session's CURRENT 1-hour block: the first boundary strictly after
 * `now`. Check in at 1:13 → 2:13, then 3:13, 4:13… The clock never resets.
 */
export function currentBlockEnd(startedAt: Date, now: Date): Date {
  const elapsed = Math.max(0, now.getTime() - startedAt.getTime());
  const blocks = Math.floor(elapsed / HOUR_MS) + 1;
  return new Date(startedAt.getTime() + blocks * HOUR_MS);
}

/** 60-minute HOUSEHOLD cooldown (non-use period) after being rotated off. */
export function cooldownExpiry(endedAt: Date): Date {
  return new Date(endedAt.getTime() + SIXTY_MIN_MS);
}

/** A queue offer holds for 10 minutes (§2.7). */
export function offerExpiry(offeredAt: Date): Date {
  return new Date(offeredAt.getTime() + TEN_MIN_MS);
}
