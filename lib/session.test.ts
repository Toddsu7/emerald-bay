import { describe, it, expect } from 'vitest';
import { currentBlockEnd, cooldownExpiry, offerExpiry } from './session';

describe('currentBlockEnd — continuous 1-hour blocks from check-in', () => {
  const started = new Date('2026-07-12T18:13:00Z'); // "1:13 PM"

  it('within the first hour, ends at start + 1h (2:13)', () => {
    expect(currentBlockEnd(started, new Date('2026-07-12T18:50:00Z')).toISOString()).toBe(
      '2026-07-12T19:13:00.000Z',
    );
  });

  it('in the second hour, ends at start + 2h (3:13) — the clock never resets', () => {
    expect(currentBlockEnd(started, new Date('2026-07-12T19:40:00Z')).toISOString()).toBe(
      '2026-07-12T20:13:00.000Z',
    );
  });

  it('a session already 5 hours in still ends on the same :13 cadence', () => {
    expect(currentBlockEnd(started, new Date('2026-07-12T23:20:00Z')).toISOString()).toBe(
      '2026-07-13T00:13:00.000Z',
    );
  });

  it('is NOT extended by "now" — no grace floor (a queue at 6:12 still ends 6:13)', () => {
    // started 6:00, now 6:12 → block ends 7:00 regardless of when a queue forms.
    const s = new Date('2026-07-12T18:00:00Z');
    expect(currentBlockEnd(s, new Date('2026-07-12T18:12:00Z')).toISOString()).toBe(
      '2026-07-12T19:00:00.000Z',
    );
  });

  it('exactly at check-in, ends one hour later', () => {
    expect(currentBlockEnd(started, started).toISOString()).toBe('2026-07-12T19:13:00.000Z');
  });
});

describe('cooldownExpiry — 1-hour non-use period', () => {
  it('is 60 minutes after coming off', () => {
    expect(cooldownExpiry(new Date('2026-07-12T19:13:00Z')).toISOString()).toBe(
      '2026-07-12T20:13:00.000Z',
    );
  });
});

describe('offerExpiry (§2.7)', () => {
  it('holds for 10 minutes', () => {
    expect(offerExpiry(new Date('2026-07-12T21:00:00Z')).toISOString()).toBe(
      '2026-07-12T21:10:00.000Z',
    );
  });
});
