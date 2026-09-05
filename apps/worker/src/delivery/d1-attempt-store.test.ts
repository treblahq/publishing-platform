import { describe, expect, it, vi } from 'vitest';

import { createD1AttemptStore } from './d1-attempt-store.js';

describe('D1 delivery attempts', () => {
  it('starts and finishes a tenant-scoped sanitized attempt', async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const statement = { bind: vi.fn(), run };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement) };
    const attempts = createD1AttemptStore(database, () => 'attempt-id', () => new Date('2026-09-04T12:00:00.000Z'));
    await expect(attempts.start('openings', 'delivery-1', 7)).resolves.toBe('attempt-id');
    await attempts.finish('openings', 'attempt-id', 'retryable', 'NETWORK');
    expect(database.prepare).toHaveBeenCalledTimes(2);
    expect(statement.bind.mock.calls[1]).toEqual(['retryable', 'NETWORK', '2026-09-04T12:00:00.000Z', 'openings', 'attempt-id']);
  });
});
