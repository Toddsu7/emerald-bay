import { describe, it, expect } from 'vitest';
import {
  computeCap,
  overByHulls,
  canAddHulls,
  lakeStatusMessage,
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

describe('lakeStatusMessage — live availability, never "capped"', () => {
  it('queue present: states the shared limit and who is waiting', () => {
    expect(lakeStatusMessage({ cap: 2, slots: 0, householdsWaiting: 3 })).toBe(
      'You can have 2 watercraft out right now. 3 households are waiting, so ' +
        'everyone shares the lake. Your limit goes back up when the queue clears.',
    );
  });
  it('singularizes a single waiting household', () => {
    expect(lakeStatusMessage({ cap: 1, slots: 0, householdsWaiting: 1 })).toContain(
      '1 household is waiting',
    );
  });
  it('no queue: frames it as availability, not a personal cap', () => {
    expect(lakeStatusMessage({ cap: 4, slots: 2, householdsWaiting: 0 })).toBe(
      'The lake has room for 2 more watercraft. No one is waiting.',
    );
  });
  it('no queue but full: says full, not capped', () => {
    expect(lakeStatusMessage({ cap: 4, slots: 0, householdsWaiting: 0 })).toBe(
      'The lake is full. No one is waiting.',
    );
  });
  it('never uses the word "capped"', () => {
    const all = [
      lakeStatusMessage({ cap: 2, slots: 0, householdsWaiting: 2 }),
      lakeStatusMessage({ cap: 4, slots: 3, householdsWaiting: 0 }),
      lakeStatusMessage({ cap: 4, slots: 0, householdsWaiting: 0 }),
    ].join(' ');
    expect(all.toLowerCase()).not.toContain('cap');
  });
});
