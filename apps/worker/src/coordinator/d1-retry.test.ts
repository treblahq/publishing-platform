import { describe, expect, it, vi } from 'vitest';

import { enqueueDueRetries } from './d1-retry.js';

describe('retry recovery', () => {
  it('reenqueues only a bounded page of due retry_wait deliveries', async () => {
    const all = vi.fn().mockResolvedValue({ results: [
      { id: 'd1', tenant_id: 'openings' }, { id: 'd2', tenant_id: 'openings' },
    ] });
    const statement = { bind: vi.fn(), all };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement), batch: vi.fn().mockResolvedValue([]) };
    await expect(enqueueDueRetries(database, 2, () => new Date('2026-09-04T12:00:00.000Z'))).resolves.toBe(2);
    expect(statement.bind).toHaveBeenCalledWith('2026-09-04T12:00:00.000Z', 2);
    expect(database.batch).toHaveBeenCalledTimes(2);
  });
});
