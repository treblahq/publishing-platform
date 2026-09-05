import { describe, expect, it, vi } from 'vitest';
import { refreshD1CapacityUsage } from './d1-refresh.js';

describe('capacity measurement refresh', () => {
  it('refreshes a bounded set of enabled tenants and measures active R2 bytes', async () => {
    const tenantStatement = statement({ all: vi.fn().mockResolvedValue({ results: [{ id: 'openings' }] }) });
    const storageStatement = statement({ first: vi.fn().mockResolvedValue({ used: 2048 }) });
    const writes = [statement({}), statement({}), statement({})];
    let capturedBatch: Array<{ bindings: unknown[] }> = [];
    const database = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM tenants')) return tenantStatement;
        if (sql.includes('FROM artifacts')) return storageStatement;
        return writes.shift();
      }),
      batch: vi.fn().mockImplementation((items: Array<{ bindings: unknown[] }>) => {
        capturedBatch = items;
        return Promise.resolve([]);
      }),
    };

    await expect(refreshD1CapacityUsage(database, 25, () => new Date('2026-09-04T15:00:00.000Z'))).resolves.toBe(1);
    expect(tenantStatement.bind).toHaveBeenCalledWith(25);
    expect(storageStatement.bind).toHaveBeenCalledWith('openings', 'openings');
    expect(database.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain("FROM artifact_uploads");
    expect(database.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain("state = 'available'");
    expect(database.batch).toHaveBeenCalledOnce();
    const bound = capturedBatch.map((item) => item.bindings);
    expect(bound).toContainEqual(['openings', 'r2Bytes', '2026-09-04T00:00:00.000Z', 2048, '2026-09-04T15:00:00.000Z']);
  });
});

function statement(methods: Record<string, unknown>) {
  const value = { bindings: [] as unknown[], bind: vi.fn(), all: vi.fn(), first: vi.fn(), ...methods };
  value.bind.mockImplementation((...values: unknown[]) => { value.bindings = values; return value; });
  return value;
}
