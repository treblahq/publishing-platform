import { describe, expect, it } from 'vitest';

import * as dispatcher from './dispatch-outbox.js';

describe('D1 outbox dispatcher', () => {
  it('does not mark work dispatched when queue send fails', async () => {
    const dispatchOutbox = Reflect.get(dispatcher, 'dispatchOutbox');
    expect(dispatchOutbox).toBeTypeOf('function');
    let marked = 0;
    await expect(dispatchOutbox({
      claimDue: () => Promise.resolve([{ id: 'outbox-1', tenantId: 'openings', deliveryId: 'delivery-1', claimToken: 'claim-1' }]),
      markDispatched: () => { marked += 1; return Promise.resolve(); },
      releaseClaim: () => Promise.resolve(),
    }, { send: () => Promise.reject(new Error('queue unavailable')) }, 10)).rejects.toThrow('queue');
    expect(marked).toBe(0);
  });

  it('safely sends the same outbox row again after a post-send crash', async () => {
    const dispatchOutbox = Reflect.get(dispatcher, 'dispatchOutbox');
    expect(dispatchOutbox).toBeTypeOf('function');
    let sends = 0;
    let marks = 0;
    const row = { id: 'outbox-1', tenantId: 'openings', deliveryId: 'delivery-1', claimToken: 'claim-1' };
    const store = {
      claimDue: () => Promise.resolve([row]),
      markDispatched: () => {
        marks += 1;
        return marks === 1 ? Promise.reject(new Error('crash after send')) : Promise.resolve();
      },
      releaseClaim: () => Promise.resolve(),
    };
    const queue = { send: () => { sends += 1; return Promise.resolve(); } };
    await expect(dispatchOutbox(store, queue, 10)).rejects.toThrow('crash');
    await expect(dispatchOutbox(store, queue, 10)).resolves.toBe(1);
    expect(sends).toBe(2);
  });
});
