import { describe, expect, it, vi } from 'vitest';

import { createD1OutboxStore } from './d1-outbox-store.js';

describe('D1 outbox store', () => {
  it('loads only due undispatched rows in a bounded page', async () => {
    const all = vi.fn().mockResolvedValue({ results: [{ id: 'o1', tenant_id: 'openings', delivery_id: 'd1', claim_token: 'claim-1' }] });
    const statement = { bind: vi.fn(), all, run: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement) };
    const store = createD1OutboxStore(database, () => new Date('2026-09-04T12:00:00.000Z'), () => 'claim-1');
    await expect(store.claimDue(25)).resolves.toEqual([{ id: 'o1', tenantId: 'openings', deliveryId: 'd1', claimToken: 'claim-1' }]);
    expect(statement.bind.mock.calls[0]).toEqual([
      '2026-09-04T12:00:00.000Z', '2026-09-04T12:00:00.000Z', 25,
      'claim-1', '2026-09-04T12:01:00.000Z', '2026-09-04T12:00:00.000Z',
    ]);
    const sql = String(database.prepare.mock.calls[0]?.[0]);
    expect(sql).toContain('delivery_dependencies');
    expect(sql).toContain("'verified'");
  });

  it('marks with both tenant and outbox id', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const statement = { bind: vi.fn(), run, all: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const store = createD1OutboxStore({ prepare: vi.fn().mockReturnValue(statement) });
    await store.markDispatched('openings', 'o1', 'claim-1');
    expect(statement.bind).toHaveBeenCalledWith('openings', 'o1', 'claim-1');
  });

  it('releases only the matching claim', async () => {
    const statement = { bind: vi.fn(), run: vi.fn().mockResolvedValue({ success: true }), all: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const store = createD1OutboxStore({ prepare: vi.fn().mockReturnValue(statement) });
    await store.releaseClaim('openings', 'o1', 'claim-1');
    expect(statement.bind).toHaveBeenCalledWith('openings', 'o1', 'claim-1');
  });
});
