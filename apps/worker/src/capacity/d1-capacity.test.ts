import { describe, expect, it } from 'vitest';

import { createD1CapacityChecker, estimateCapacityRequests } from './d1-capacity.js';

const envelope = {
  artifacts: [],
  deliveries: [{ id: 'web' }, { id: 'push' }],
};

function database(rows: Record<string, { used: number; reserved: number; measured_at: string } | undefined>) {
  return {
    prepare: () => {
      let resource = '';
      const statement = {
        bind: (...values: unknown[]) => { resource = String(values.at(-1)); return statement; },
        first: () => Promise.resolve(rows[resource] ?? null),
      };
      return statement;
    },
  };
}

describe('D1 free-tier capacity checker', () => {
  it('does not reserve temporary bytes again after verified upload', () => {
    expect(estimateCapacityRequests({
      artifacts: [{ storage: 'r2-temporary', byteSize: 500 }], deliveries: [],
    }).r2Bytes).toBe(0);
  });

  it('accepts only when every measured resource has headroom', async () => {
    const rows = Object.fromEntries(['d1Rows', 'queueOperations', 'r2Bytes'].map((resource) => [
      resource, { used: 10, reserved: 0, measured_at: '2026-09-04T11:55:00.000Z' },
    ]));
    const check = createD1CapacityChecker(database(rows), {
      d1Rows: 1_000, queueOperations: 1_000, r2Bytes: 1_000,
    }, () => new Date('2026-09-04T12:00:00.000Z'));
    await expect(check('openings', envelope)).resolves.toEqual({ accepted: true });
  });

  it('fails closed when a measurement is absent or stale', async () => {
    const check = createD1CapacityChecker(database({}), {
      d1Rows: 1_000, queueOperations: 1_000, r2Bytes: 1_000,
    }, () => new Date('2026-09-04T12:00:00.000Z'));
    await expect(check('openings', envelope)).resolves.toMatchObject({ accepted: false });
  });
});
