import { describe, it, expect } from 'vitest';
import {
  computeCap,
  overByHulls,
  canAddHulls,
  clampMessage,
} from './caps';

describe('computeCap — fair-share (§2.6)', () => {
  it('no queue: a single household may hold the whole lake', () => {
    expect(
      computeCap({ lakeCapacity: 4, householdsOnWater: 1, householdsWaiting: 0 }),
    ).toBe(4);
  });

  it('no queue with two households on water: still full capacity each (not floor/2)', () => {
    // §2.6: "When nobody is waiting, a household may hold as many hulls as it
    // likes, up to lake capacity." open-slots (gate 6) does the real limiting.
    expect(
      computeCap({ lakeCapacity: 4, householdsOnWater: 2, householdsWaiting: 0 }),
    ).toBe(4);
  });

  it('worked example: 1 on water + 1 waiting → cap 2', () => {
    // East cap 4. Millers (1 household) have 3 out; you queue.
    expect(
      computeCap({ lakeCapacity: 4, householdsOnWater: 1, householdsWaiting: 1 }),
    ).toBe(2);
  });

  it('worked example: 2 on water + 1 waiting → cap 1', () => {
    expect(
      computeCap({ lakeCapacity: 4, householdsOnWater: 2, householdsWaiting: 1 }),
    ).toBe(1);
  });

  it('never drops below 1 even when heavily oversubscribed', () => {
    expect(
      computeCap({ lakeCapacity: 3, householdsOnWater: 5, householdsWaiting: 4 }),
    ).toBe(1);
  });

  it('West (cap 3): 1 on water + 1 waiting → floor(3/2) = 1', () => {
    expect(
      computeCap({ lakeCapacity: 3, householdsOnWater: 1, householdsWaiting: 1 }),
    ).toBe(1);
  });
});

describe('overByHulls', () => {
  it('Millers clamp from 3 → 2 is over-by-1', () => {
    expect(overByHulls(3, 2)).toBe(1);
  });
  it('within cap is over-by-0', () => {
    expect(overByHulls(2, 2)).toBe(0);
    expect(overByHulls(1, 4)).toBe(0);
  });
});

describe('canAddHulls — gate 7', () => {
  it('allows adding up to the cap', () => {
    expect(canAddHulls(0, 2, 2)).toBe(true);
    expect(canAddHulls(1, 1, 2)).toBe(true);
  });
  it('blocks going over the cap', () => {
    expect(canAddHulls(2, 1, 2)).toBe(false);
    expect(canAddHulls(1, 2, 2)).toBe(false);
  });
});

describe('clampMessage — live explanation', () => {
  it('matches the spec example for cap 1, 3 waiting', () => {
    expect(clampMessage({ cap: 1, householdsWaiting: 3 })).toBe(
      "You're capped at 1 watercraft right now — 3 households are waiting. " +
        'Your cap goes back up when the queue clears.',
    );
  });
  it('singularizes a single waiting household', () => {
    expect(clampMessage({ cap: 2, householdsWaiting: 1 })).toContain(
      '1 household is waiting',
    );
  });
});
