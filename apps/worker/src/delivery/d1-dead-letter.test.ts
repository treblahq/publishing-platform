import { describe, expect, it, vi } from 'vitest';
import { handleD1DeadLetterBatch } from './d1-dead-letter.js';

describe('dead-letter persistence', () => {
  it('moves the same durable delivery to needs_attention and acknowledges after commit', async () => {
    const statement = { bind: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement), batch: vi.fn().mockResolvedValue([]) };
    const ack = vi.fn();
    const retry = vi.fn();
    await handleD1DeadLetterBatch(database, [{
      body: { tenantId: 'openings', deliveryId: 'delivery-1' }, ack, retry,
    }], () => 'audit-id');
    expect(database.batch).toHaveBeenCalledOnce();
    expect(database.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain("state = 'needs_attention'");
    expect(statement.bind).toHaveBeenCalledWith('openings', 'delivery-1');
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries when the D1 commit fails', async () => {
    const statement = { bind: vi.fn() };
    statement.bind.mockReturnValue(statement);
    const ack = vi.fn();
    const retry = vi.fn();
    await handleD1DeadLetterBatch({
      prepare: vi.fn().mockReturnValue(statement), batch: vi.fn().mockRejectedValue(new Error('D1 unavailable')),
    }, [{ body: { tenantId: 'openings', deliveryId: 'delivery-1' }, ack, retry }]);
    expect(retry).toHaveBeenCalledOnce();
    expect(ack).not.toHaveBeenCalled();
  });
});
