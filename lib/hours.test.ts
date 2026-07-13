import { describe, it, expect } from 'vitest';
import {
  legalWindow,
  isWithinLegalHours,
  combinedWindow,
  allWithinLegalHours,
  assertCheckinable,
} from './hours';
import type { SunTimes } from './types';

// Fixed instants for one imaginary day (UTC). Values are arbitrary but internally
// consistent — the logic is what's under test, not the astronomy (that's sun.test).
//   sunrise 11:00Z, tenAmLocal 15:00Z (10:00 CDT), sunset 01:00Z(+1d)
const sun: SunTimes = {
  sunrise: new Date('2026-07-12T11:00:00Z'),
  tenAmLocal: new Date('2026-07-12T15:00:00Z'),
  sunset: new Date('2026-07-13T01:00:00Z'),
};

describe('legalWindow (§2.2)', () => {
  it('jet ski: 10:00 AM → sunset (tight on both ends)', () => {
    const w = legalWindow('Jet Ski', sun);
    expect(w.earliest.toISOString()).toBe('2026-07-12T15:00:00.000Z');
    expect(w.latest.toISOString()).toBe('2026-07-13T01:00:00.000Z');
  });

  it('boat types: sunrise − 30m → sunset + 30m', () => {
    for (const t of ['Pontoon', 'Ski/Surf boat', 'Fishing boat'] as const) {
      const w = legalWindow(t, sun);
      expect(w.earliest.toISOString()).toBe('2026-07-12T10:30:00.000Z'); // 11:00 − 30
      expect(w.latest.toISOString()).toBe('2026-07-13T01:30:00.000Z'); // 01:00 + 30
    }
  });

  it('a jet ski and a ski boat starting together have different hard stops', () => {
    const jet = legalWindow('Jet Ski', sun).latest.getTime();
    const boat = legalWindow('Ski/Surf boat', sun).latest.getTime();
    expect(boat).toBeGreaterThan(jet); // boat runs 30 min past sunset; jet stops at sunset
  });
});

describe('isWithinLegalHours', () => {
  it('a jet ski at 09:59 local (14:59Z) is too early', () => {
    expect(
      isWithinLegalHours('Jet Ski', new Date('2026-07-12T14:59:00Z'), sun),
    ).toBe(false);
  });
  it('a jet ski at 10:01 local is fine', () => {
    expect(
      isWithinLegalHours('Jet Ski', new Date('2026-07-12T15:01:00Z'), sun),
    ).toBe(true);
  });
  it('a boat is already legal at sunrise − 15m while a jet ski is not', () => {
    const at = new Date('2026-07-12T10:45:00Z'); // sunrise − 15m
    expect(isWithinLegalHours('Pontoon', at, sun)).toBe(true);
    expect(isWithinLegalHours('Jet Ski', at, sun)).toBe(false);
  });
  it('a jet ski 15 min after sunset is out; a boat is still in', () => {
    const at = new Date('2026-07-13T01:15:00Z');
    expect(isWithinLegalHours('Jet Ski', at, sun)).toBe(false);
    expect(isWithinLegalHours('Fishing boat', at, sun)).toBe(true);
  });
});

describe('combinedWindow — mixed session (gate 5)', () => {
  it('a jet ski + boat session is bounded by the jet ski on both ends', () => {
    const w = combinedWindow(['Jet Ski', 'Pontoon'], sun);
    // latest earliest = jet ski's 10:00; earliest latest = jet ski's sunset
    expect(w.earliest.toISOString()).toBe('2026-07-12T15:00:00.000Z');
    expect(w.latest.toISOString()).toBe('2026-07-13T01:00:00.000Z');
  });

  it('allWithinLegalHours: 15 min after sunset fails a mixed jet-ski+boat session', () => {
    const at = new Date('2026-07-13T01:15:00Z');
    expect(allWithinLegalHours(['Jet Ski', 'Pontoon'], at, sun)).toBe(false);
    expect(allWithinLegalHours(['Pontoon'], at, sun)).toBe(true);
  });
});

describe('assertCheckinable', () => {
  it('passes checkinable types through', () => {
    expect(assertCheckinable('Pontoon')).toBe('Pontoon');
  });
  it('throws for E-Foil / Sail boat / Other', () => {
    expect(() => assertCheckinable('E-Foil')).toThrow();
    expect(() => assertCheckinable('Sail boat')).toThrow();
    expect(() => assertCheckinable('Other')).toThrow();
  });
});
