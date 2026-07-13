// Legal operating hours (BUILD SPEC §2.2). All sunset-relative.
//
//   Jet Ski ............................ 10:00 AM  →  sunset
//   Pontoon / Ski-Surf / Fishing ....... sunrise − 30m  →  sunset + 30m
//
// The jet-ski window is tighter on BOTH ends. A jet-ski session and a ski-boat
// session starting at the same moment have different hard stops.
//
// This module is PURE: it takes the day's instants (SunTimes) and returns
// windows. Astronomy + timezone resolution lives in lib/sun.ts.

import type { CheckinableCraftType, CraftType, SunTimes } from './types';
import { isCheckinableType } from './types';

const THIRTY_MIN_MS = 30 * 60 * 1000;

export interface Window {
  earliest: Date;
  latest: Date;
}

/** Legal window for one checkinable craft type on a given day. */
export function legalWindow(
  craft: CheckinableCraftType,
  sun: SunTimes,
): Window {
  if (craft === 'Jet Ski') {
    return { earliest: sun.tenAmLocal, latest: sun.sunset };
  }
  // Pontoon, Ski/Surf boat, Fishing boat — wider on both ends.
  return {
    earliest: new Date(sun.sunrise.getTime() - THIRTY_MIN_MS),
    latest: new Date(sun.sunset.getTime() + THIRTY_MIN_MS),
  };
}

/** Is `at` inside this craft's legal window? */
export function isWithinLegalHours(
  craft: CheckinableCraftType,
  at: Date,
  sun: SunTimes,
): boolean {
  const w = legalWindow(craft, sun);
  return at.getTime() >= w.earliest.getTime() && at.getTime() <= w.latest.getTime();
}

/**
 * The combined window for a SET of crafts sharing one session: you may only be on
 * the water while EVERY hull is legal (§4 gate 5). So the combined window is the
 * latest of the earliests and the earliest of the latests. Its `latest` is also
 * the session's hours-derived hard stop (used by the sweep and the board's
 * "ends at").
 */
export function combinedWindow(
  crafts: CheckinableCraftType[],
  sun: SunTimes,
): Window {
  if (crafts.length === 0) {
    throw new Error('combinedWindow: no crafts');
  }
  const windows = crafts.map((c) => legalWindow(c, sun));
  const earliest = new Date(
    Math.max(...windows.map((w) => w.earliest.getTime())),
  );
  const latest = new Date(Math.min(...windows.map((w) => w.latest.getTime())));
  return { earliest, latest };
}

/** All selected crafts legal at instant `at`? (gate 5) */
export function allWithinLegalHours(
  crafts: CheckinableCraftType[],
  at: Date,
  sun: SunTimes,
): boolean {
  const w = combinedWindow(crafts, sun);
  return at.getTime() >= w.earliest.getTime() && at.getTime() <= w.latest.getTime();
}

/**
 * Guard for callers holding a possibly-non-checkinable CraftType. Throws if a
 * non-checkinable type (E-Foil, Sail boat, Other) reaches the hours logic — those
 * never check in, so asking for their window is a bug upstream.
 */
export function assertCheckinable(t: CraftType): CheckinableCraftType {
  if (!isCheckinableType(t)) {
    throw new Error(`assertCheckinable: ${t} does not check in and has no legal window`);
  }
  return t;
}
