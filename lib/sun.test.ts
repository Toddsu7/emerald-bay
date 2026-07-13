import { describe, it, expect } from 'vitest';
import {
  zonedWallTimeToUtc,
  chicagoCivilDate,
  sunTimesForDate,
  chicagoClock,
  LAKE_TZ,
} from './sun';

function hourInChicago(d: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: LAKE_TZ,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(d),
  );
}

describe('zonedWallTimeToUtc', () => {
  it('resolves 10:00 CDT (summer) to 15:00 UTC', () => {
    const d = zonedWallTimeToUtc('2026-07-12', 10, 0);
    expect(d.toISOString()).toBe('2026-07-12T15:00:00.000Z'); // CDT = UTC−5
  });
  it('resolves 10:00 CST (winter) to 16:00 UTC', () => {
    const d = zonedWallTimeToUtc('2026-01-12', 10, 0);
    expect(d.toISOString()).toBe('2026-01-12T16:00:00.000Z'); // CST = UTC−6
  });
});

describe('chicagoCivilDate', () => {
  it('formats as YYYY-MM-DD in Chicago', () => {
    // 03:00 UTC on Jul 13 is still Jul 12 (22:00) in Chicago.
    expect(chicagoCivilDate(new Date('2026-07-13T03:00:00Z'))).toBe('2026-07-12');
  });
});

describe('sunTimesForDate — Wichita', () => {
  const sun = sunTimesForDate('2026-07-12');

  it('10:00 local floor renders as 10:00 AM in Chicago', () => {
    expect(chicagoClock(sun.tenAmLocal)).toBe('10:00 AM');
  });

  it('midsummer sunrise is in the 5–6 AM hour, sunset in the 8–9 PM hour', () => {
    expect(hourInChicago(sun.sunrise)).toBeGreaterThanOrEqual(5);
    expect(hourInChicago(sun.sunrise)).toBeLessThanOrEqual(6);
    expect(hourInChicago(sun.sunset)).toBeGreaterThanOrEqual(20);
    expect(hourInChicago(sun.sunset)).toBeLessThanOrEqual(21);
  });

  it('sunset is after sunrise', () => {
    expect(sun.sunset.getTime()).toBeGreaterThan(sun.sunrise.getTime());
  });
});
