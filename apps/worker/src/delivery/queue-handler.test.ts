import { describe, expect, it, vi } from 'vitest';

import { handleDeliveryBatch } from './queue-handler.js';

function message(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

describe('delivery queue acknowledgement', () => {
  it('acknowledges only after durable processing completes', async () => {
    const item = message({ tenantId: 'openings', deliveryId: 'd1' });
    const order: string[] = [];
    item.ack.mockImplementation(() => { order.push('ack'); });
    await handleDeliveryBatch([item], () => { order.push('commit'); return Promise.resolve(); });
    expect(order).toEqual(['commit', 'ack']);
    expect(item.retry).not.toHaveBeenCalled();
  });

  it('retries failures and malformed messages without acknowledging', async () => {
    const failed = message({ tenantId: 'openings', deliveryId: 'd1' });
    const malformed = message({ deliveryId: 'd2' });
    await handleDeliveryBatch([failed, malformed], () => Promise.reject(new Error('D1 unavailable')));
    expect(failed.retry).toHaveBeenCalledOnce();
    expect(malformed.retry).toHaveBeenCalledOnce();
    expect(failed.ack).not.toHaveBeenCalled();
  });
});
