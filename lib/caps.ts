// Fair-share clamp (BUILD SPEC §2.6).
//
// When nobody is waiting, a household may hold as many hulls as it likes, up to
// lake capacity. When a queue forms, each household's per-lake cap becomes:
//
//     cap = max(1, floor(lake_capacity / (households_on_water + households_waiting)))
//
// Recomputed on every queue join, queue leave, session start, and session end.
// This is the authoritative arithmetic; the check-in DB function (§4) and the UI
// (§2.6 "explain it live, with real numbers") both call through here.

export interface CapInputs {
  lakeCapacity: number;
  /** Distinct households with ≥1 open session on this lake. */
  householdsOnWater: number;
  /** Distinct households in the active queue (waiting or offered) on this lake. */
  householdsWaiting: number;
}

/**
 * The lake-wide per-household hull cap. Same scalar for every household on the
 * lake given the counts.
 *
 * Key rule: with NO queue (nobody waiting), the cap is the full lake capacity —
 * NOT floor(capacity / on_water). A single household may hold every slot when no
 * one is waiting. The division only kicks in once a queue exists.
 */
export function computeCap({
  lakeCapacity,
  householdsOnWater,
  householdsWaiting,
}: CapInputs): number {
  if (householdsWaiting <= 0) return lakeCapacity; // no queue → up to full capacity
  const denom = householdsOnWater + householdsWaiting;
  if (denom <= 0) return lakeCapacity; // defensive; unreachable when waiting > 0
  return Math.max(1, Math.floor(lakeCapacity / denom));
}

/** How many hulls a household is over its cap (0 if within). */
export function overByHulls(currentHulls: number, cap: number): number {
  return Math.max(0, currentHulls - cap);
}

/**
 * Gate 7 (§4): may this household add `addCount` more hulls right now?
 * Uses the cap computed for the CURRENT counts. When no queue exists, cap is the
 * full lake capacity, so this reduces to "fits under capacity" (gate 6 still
 * enforces open slots separately).
 */
export function canAddHulls(
  currentHulls: number,
  addCount: number,
  cap: number,
): boolean {
  return currentHulls + addCount <= cap;
}

/**
 * The live clamp explanation the UI must show (§2.6). Real numbers, not a canned
 * string — "People accept a rule they can watch working."
 */
export function clampMessage({
  cap,
  householdsWaiting,
}: {
  cap: number;
  householdsWaiting: number;
}): string {
  const craft = cap === 1 ? 'watercraft' : 'watercraft';
  const households =
    householdsWaiting === 1 ? '1 household is' : `${householdsWaiting} households are`;
  return (
    `You're capped at ${cap} ${craft} right now — ${households} waiting. ` +
    `Your cap goes back up when the queue clears.`
  );
}
