import { describe, it, expect } from 'vitest';
import {
  hardEndOnQueueForm,
  cooldownExpiry,
  offerExpiry,
  effectiveEnd,
} from './session';

describe('hardEndOnQueueForm (§2.4)', () => {
  it('a fresh session (just started) gets now + 60m, not now + 10m', () => {
    const now = new Date('2026-07-12T20:00:00Z');
    const started = new Date('2026-07-12T20:00:00Z');
    expect(hardEndOnQueueForm(now, started).toISOString()).toBe(
      '2026-07-12T21:00:00.000Z',
    );
  });

  it('a session already 55 min in gets now + 10m (never ambushed)', () => {
    const started = new Date('2026-07-12T20:00:00Z');
    const now = new Date('2026-07-12T20:55:00Z');
    // start+60 = 21:00, now+10 = 21:05 → the later wins
    expect(hardEndOnQueueForm(now, started).toISOString()).toBe(
      '2026-07-12T21:05:00.000Z',
    );
  });

  it('a session already 2 h in still gets a full 10-min warning', () => {
    const started = new Date('2026-07-12T18:00:00Z');
    const now = new Date('2026-07-12T20:00:00Z');
    expect(hardEndOnQueueForm(now, started).toISOString()).toBe(
      '2026-07-12T20:10:00.000Z',
    );
  });
});

describe('cooldownExpiry (§2.4/§2.5)', () => {
  it('is 60 minutes after the session ends', () => {
    expect(cooldownExpiry(new Date('2026-07-12T21:00:00Z')).toISOString()).toBe(
      '2026-07-12T22:00:00.000Z',
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

describe('effectiveEnd', () => {
  const hours = new Date('2026-07-13T01:00:00Z'); // sunset stop
  it('with no queue, ends at the hours boundary', () => {
    expect(effectiveEnd(hours, null).toISOString()).toBe('2026-07-13T01:00:00.000Z');
  });
  it('with a queue hard end sooner, ends at the hard end', () => {
    const hardEnd = new Date('2026-07-12T21:05:00Z');
    expect(effectiveEnd(hours, hardEnd).toISOString()).toBe(
      '2026-07-12T21:05:00.000Z',
    );
  });
  it('with a queue hard end later than hours, still ends at hours', () => {
    const hardEnd = new Date('2026-07-13T02:00:00Z');
    expect(effectiveEnd(hours, hardEnd).toISOString()).toBe('2026-07-13T01:00:00.000Z');
  });
});
