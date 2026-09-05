import { describe, expect, it, vi } from 'vitest';

import { runD1ArtifactCleanup, runD1UploadCleanup } from './d1-cleanup.js';

describe('D1 and R2 artifact collector', () => {
  it('tombstones, deletes, marks, and advances the cursor in that order', async () => {
    const order: string[] = [];
    const database = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        const statement = {
          bind: vi.fn(),
          first: () => Promise.resolve(sql.includes('maintenance_cursors') ? { cursor: '' } : null),
          all: () => Promise.resolve({ results: [{ id: 'a1', tenant_id: 'openings', locator: 'tmp/a1' }] }),
          run: () => { order.push(sql.includes("state = 'tombstoned'") ? 'tombstone' : sql.includes("state = 'deleted'") ? 'mark' : 'cursor'); return Promise.resolve({}); },
        };
        statement.bind.mockReturnValue(statement);
        return statement;
      }),
    };
    const bucket = { delete: vi.fn().mockImplementation(() => { order.push('delete'); return Promise.resolve(); }) };
    await expect(runD1ArtifactCleanup(database, bucket, 10)).resolves.toBe(1);
    expect(order).toEqual(['tombstone', 'delete', 'mark', 'cursor']);
    expect(bucket.delete).toHaveBeenCalledWith('tmp/a1');
  });

  it('query explicitly excludes ambiguous delivery references', async () => {
    const database = {
      prepare: vi.fn().mockImplementation(() => {
        const statement = { bind: vi.fn(), first: () => Promise.resolve({ cursor: '' }), all: () => Promise.resolve({ results: [] }), run: () => Promise.resolve({}) };
        statement.bind.mockReturnValue(statement);
        return statement;
      }),
    };
    await runD1ArtifactCleanup(database, { delete: () => Promise.resolve() }, 10);
    expect(database.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain("state = 'reconciling'");
  });
});

describe('temporary upload collector', () => {
  it('deletes expired unclaimed uploads and releases outstanding reservations', async () => {
    const order: string[] = [];
    const database = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        const statement = {
          bind: vi.fn(),
          first: () => Promise.resolve(sql.includes('maintenance_cursors') ? { cursor: '' } : null),
          all: () => Promise.resolve({ results: [{ id: 'u1', tenant_id: 'openings', locator: 'temporary/openings/u1/hash.mp4' }] }),
          run: () => {
            order.push(sql.includes("SET state = 'failed'") ? 'claim' : sql.includes("state = 'deleted'") ? 'mark' : sql.includes('capacity_reservations') ? 'release' : 'cursor');
            return Promise.resolve({});
          },
        };
        statement.bind.mockReturnValue(statement);
        return statement;
      }),
    };
    const bucket = { delete: vi.fn().mockImplementation(() => { order.push('delete'); return Promise.resolve(); }) };

    await expect(runD1UploadCleanup(database, bucket, 10)).resolves.toBe(1);
    expect(order).toEqual(['claim', 'delete', 'mark', 'release', 'cursor']);
    expect(bucket.delete).toHaveBeenCalledWith('temporary/openings/u1/hash.mp4');
    expect(database.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain("state IN ('uploading', 'available', 'failed')");
  });
});
