import { describe, expect, it, vi } from 'vitest';

import { runD1Reconciliation } from './d1-reconciliation.js';

describe('D1 reconciliation collector', () => {
  it('processes only a bounded tenant-scoped page of ambiguous deliveries', async () => {
    const all = vi.fn().mockResolvedValue({ results: [
      { id: 'd1', tenant_id: 'openings' },
      { id: 'd2', tenant_id: 'troco' },
    ] });
    const statement = { bind: vi.fn(), all };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement) };
    const process = vi.fn().mockResolvedValue(undefined);

    await expect(runD1Reconciliation(database, 2, process)).resolves.toBe(2);

    expect(statement.bind).toHaveBeenCalledWith(2);
    expect(process).toHaveBeenNthCalledWith(1, { tenantId: 'openings', deliveryId: 'd1' });
    expect(process).toHaveBeenNthCalledWith(2, { tenantId: 'troco', deliveryId: 'd2' });
    expect(database.prepare.mock.calls[0]?.[0]).toContain("state = 'reconciling'");
  });

  it('rejects an unbounded page size', async () => {
    await expect(runD1Reconciliation({ prepare: vi.fn() }, 101, vi.fn())).rejects.toThrow('between 1 and 100');
  });
});
