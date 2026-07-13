// Session length, cooldown, and offer timing (BUILD SPEC §2.4, §2.7). Pure.

export const TEN_MIN_MS = 10 * 60 * 1000;
export const SIXTY_MIN_MS = 60 * 60 * 1000;

/**
 * When a queue forms, every active session immediately gets a hard end (§2.4):
 *
 *     hard_end = max(now + 10m, started_at + 60m)
 *
 * "Nobody is ambushed off the water" (always ≥ 10 min warning) "and nobody gets to
 * stretch" (never past 60 min from their start).
 */
export function hardEndOnQueueForm(now: Date, startedAt: Date): Date {
  const nowPlus10 = now.getTime() + TEN_MIN_MS;
  const startPlus60 = startedAt.getTime() + SIXTY_MIN_MS;
  return new Date(Math.max(nowPlus10, startPlus60));
}

/**
 * 60-minute HOUSEHOLD cooldown after a queued-out (or clamped) session ends
 * (§2.4/§2.5). Household-level, and it blocks queueing too — the exploit fix.
 */
export function cooldownExpiry(endedAt: Date): Date {
  return new Date(endedAt.getTime() + SIXTY_MIN_MS);
}

/** A queue offer holds for 10 minutes (§2.7). */
export function offerExpiry(offeredAt: Date): Date {
  return new Date(offeredAt.getTime() + TEN_MIN_MS);
}

/** Soft 60-min nudge when NO queue exists (§2.4) — display only, no enforcement. */
export function softNudgeAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + SIXTY_MIN_MS);
}

/**
 * The instant a session actually ends: the earlier of its hours-derived stop
 * (combinedWindow.latest, §2.2) and its queue-imposed hard end (if any). Used by
 * the board ("ends at") and the sweep.
 */
export function effectiveEnd(hoursLatest: Date, hardEndAt: Date | null): Date {
  if (!hardEndAt) return hoursLatest;
  return new Date(Math.min(hoursLatest.getTime(), hardEndAt.getTime()));
}
