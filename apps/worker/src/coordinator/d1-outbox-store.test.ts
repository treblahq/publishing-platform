import { describe, expect, it, vi } from 'vitest';

import { createD1OutboxStore } from './d1-outbox-store.js';

describe('D1 outbox store', () => {
  it('loads only due undispatched rows in a bounded page', async () => {
    const all = vi.fn().mockResolvedValue({ results: [{ id: 'o1', tenant_id: 'openings', delivery_id: 'd1' }] });
    const statement = { bind: vi.fn(), all, run: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const store = createD1OutboxStore({ prepare: vi.fn().mockReturnValue(statement) }, () => new Date('2026-09-04T12:00:00.000Z'));
    await expect(store.listDue(25)).resolves.toEqual([{ id: 'o1', tenantId: 'openings', deliveryId: 'd1' }]);
    expect(statement.bind).toHaveBeenCalledWith('2026-09-04T12:00:00.000Z', 25);
  });

  it('marks with both tenant and outbox id', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const statement = { bind: vi.fn(), run, all: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const store = createD1OutboxStore({ prepare: vi.fn().mockReturnValue(statement) });
    await store.markDispatched('openings', 'o1');
    expect(statement.bind).toHaveBeenCalledWith('openings', 'o1');
  });
});
