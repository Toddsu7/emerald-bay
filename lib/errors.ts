// Map the engine's stable error codes (raised by the 0003 functions) to friendly
// text. A refusal is NOT an error — each of the §4 gates raises a specific code and
// the UI must show exactly why check-in was refused.
//
// IMPORTANT: supabase.rpc() returns a PostgrestError, which is a PLAIN OBJECT, not
// an `Error` instance. Its raised-exception text lives in `.message` (and `.details`
// / `.hint`). Earlier this code did `err instanceof Error ? err.message : String(err)`
// → `String(<plain object>)` = "[object Object]" → matched no code → generic
// fallback for every gate. rawText() below reads the object fields instead.

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

export const ENGINE_CODES = Object.keys(ENGINE_ERROR_MESSAGES);

/** Pull the meaningful text out of whatever the RPC/throw handed us. */
export function rawText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    return [e.message, e.details, e.hint, e.code].filter(Boolean).join(' ');
  }
  return String(err);
}

/** The first engine code present in the error, or null. */
export function matchCode(err: unknown): string | null {
  const raw = rawText(err);
  return ENGINE_CODES.find((code) => raw.includes(code)) ?? null;
}

/** Static friendly message (no live numbers). Use describeCheckInError for rich text. */
export function engineMessage(err: unknown): string {
  const code = matchCode(err);
  return code ? ENGINE_ERROR_MESSAGES[code] : 'Something went wrong. Please try again.';
}
