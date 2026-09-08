import { describe, expect, it } from 'vitest';

import { evaluateCapacity, evaluateR2Capacity } from './evaluate.js';

const measuredAt = new Date('2026-09-04T12:00:00.000Z');
const now = new Date('2026-09-04T12:05:00.000Z');

describe('free-tier capacity admission', () => {
  it.each([
    { measuredAt: new Date('invalid') },
    { now: new Date('invalid') },
    { maxAgeMs: Number.NaN },
    { maxAgeMs: Number.POSITIVE_INFINITY },
    { maxAgeMs: -1 },
    { used: Number.MAX_SAFE_INTEGER, requested: 1, internalBudget: 1e30 },
  ])('rejects uncertain clocks, freshness policies and arithmetic: %j', (override) => {
    expect(evaluateCapacity({
      used: 1, reserved: 0, requested: 1, internalBudget: 1_000,
      measuredAt, now, maxAgeMs: 3_600_000, ...override,
    })).toMatchObject({ state: 'reject', accepted: false, reason: 'usage-uncertain' });
  });

  it.each([
    [599, 'normal', true],
    [600, 'warning', true],
    [699, 'warning', true],
    [700, 'reject', false],
  ] as const)('classifies projected usage %s as %s', (used, state, accepted) => {
    expect(evaluateCapacity({
      used,
      reserved: 0,
      requested: 0,
      internalBudget: 1_000,
      measuredAt,
      now,
      maxAgeMs: 60 * 60 * 1_000,
    })).toMatchObject({ state, accepted });
  });

  it('reserves enough capacity to finish already accepted work', () => {
    expect(evaluateCapacity({
      used: 550,
      reserved: 149,
      requested: 1,
      internalBudget: 1_000,
      measuredAt,
      now,
      maxAgeMs: 60 * 60 * 1_000,
    })).toMatchObject({ state: 'reject', accepted: false, projected: 700 });
  });

  it.each([undefined, new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-04T12:06:00.000Z')])(
    'fails closed when usage is missing, stale or in the future',
    (observation) => {
      expect(evaluateCapacity({
        used: 1,
        reserved: 0,
        requested: 1,
        internalBudget: 1_000,
        measuredAt: observation,
        now,
        maxAgeMs: 60 * 60 * 1_000,
      })).toMatchObject({ state: 'reject', accepted: false, reason: 'usage-uncertain' });
    },
  );
});

describe('R2 storage admission', () => {
  const GB = 1024 ** 3;

  it('warns at 4 GB and rejects nonessential live storage at 5 GB', () => {
    expect(evaluateR2Capacity(4 * GB, 0, 'temporary')).toMatchObject({ state: 'warning', accepted: true });
    expect(evaluateR2Capacity(5 * GB, 0, 'live-nonessential')).toMatchObject({ state: 'reject', accepted: false });
  });

  it('rejects every new object at the 7 GB hard operational limit', () => {
    expect(evaluateR2Capacity(7 * GB, 0, 'temporary')).toMatchObject({ state: 'reject', accepted: false });
  });
});
