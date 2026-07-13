// Sunrise / sunset for the Emerald Bay lakes, plus timezone resolution.
//
// The lakes are in the Wichita, KS area; all legal hours (§2.2) are computed for
// that location and rendered in America/Chicago. This module owns the astronomy
// and the wall-clock↔UTC conversion; lib/hours.ts stays pure over the instants
// it produces.

import SunCalc from 'suncalc';
import type { SunTimes } from './types';

// Wichita, KS.
export const LAKE_LAT = 37.6872;
export const LAKE_LNG = -97.3301;
export const LAKE_TZ = 'America/Chicago';

/**
 * Offset (ms) of `timeZone` from UTC at the given instant. Positive east of UTC;
 * Chicago is negative (−5h CDT / −6h CST).
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - instant.getTime();
}

/**
 * The UTC instant for `civilDate` (YYYY-MM-DD) at wall time hh:mm in `timeZone`.
 * Two-pass so a DST boundary near the target still resolves correctly.
 */
export function zonedWallTimeToUtc(
  civilDate: string,
  hh: number,
  mm: number,
  timeZone: string = LAKE_TZ,
): Date {
  const [y, m, d] = civilDate.split('-').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  let offset = tzOffsetMs(new Date(naiveUtc), timeZone);
  let result = new Date(naiveUtc - offset);
  offset = tzOffsetMs(result, timeZone); // refine once
  result = new Date(naiveUtc - offset);
  return result;
}

/** The America/Chicago civil date (YYYY-MM-DD) for an instant. */
export function chicagoCivilDate(instant: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAKE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(instant); // en-CA formats as YYYY-MM-DD
}

/** Sunrise, sunset, and the 10:00-AM local floor for one civil date. */
export function sunTimesForDate(civilDate: string): SunTimes {
  const noonLocal = zonedWallTimeToUtc(civilDate, 12, 0);
  const t = SunCalc.getTimes(noonLocal, LAKE_LAT, LAKE_LNG);
  return {
    sunrise: t.sunrise,
    sunset: t.sunset,
    tenAmLocal: zonedWallTimeToUtc(civilDate, 10, 0),
  };
}

/** Convenience: today's SunTimes for the lakes. */
export function sunTimesToday(now: Date = new Date()): SunTimes {
  return sunTimesForDate(chicagoCivilDate(now));
}

/** Render an instant as an America/Chicago clock time, e.g. "4:15 PM". */
export function chicagoClock(instant: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: LAKE_TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
}
