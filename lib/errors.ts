// Map the engine's stable error codes (raised by the 0003 functions) to friendly
// text. The RPC error message contains the code; we substring-match it.

export const ENGINE_ERROR_MESSAGES: Record<string, string> = {
  SUSPENDED: 'Your household is suspended and can’t check in or queue.',
  COOLDOWN: 'Your household is in a 60-minute cooldown. Try again once it clears.',
  INVALID_HULL:
    'One of the selected watercraft isn’t eligible — not yours, inactive, or not a checkinable type.',
  HULL_IN_USE: 'One of the selected watercraft is already on the water.',
  OUT_OF_HOURS: 'It’s outside the legal hours for one of the selected watercraft.',
  LAKE_FULL: 'The lake is full right now.',
  OVER_CAP:
    'That would put your household over its fair-share limit while others are waiting.',
  NO_HULLS: 'Select at least one watercraft.',
  SUN_TIMES_MISSING: 'Sunrise/sunset for today isn’t loaded yet — try again in a moment.',
  LAKE_NOT_FOUND: 'That lake wasn’t found.',
  OFFER_EXPIRED: 'That queue offer has expired.',
  OFFER_INVALID: 'That queue offer is no longer valid.',
  ALREADY_QUEUED: 'Your household is already in this lake’s queue.',
  SESSION_NOT_FOUND: 'That session wasn’t found.',
};

export function engineMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  for (const code of Object.keys(ENGINE_ERROR_MESSAGES)) {
    if (raw.includes(code)) return ENGINE_ERROR_MESSAGES[code];
  }
  return 'Something went wrong. Please try again.';
}
