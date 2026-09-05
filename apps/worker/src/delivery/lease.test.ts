import { describe, expect, it } from 'vitest';

import * as leases from './lease.js';

describe('delivery lease fencing', () => {
  it('allows only one consumer to hold an unexpired lease', () => {
    const createMemoryLeaseStore = Reflect.get(leases, 'createMemoryLeaseStore');
    expect(createMemoryLeaseStore).toBeTypeOf('function');
    const store = createMemoryLeaseStore();
    const first = store.acquire('tenant-1', 'delivery-1', new Date('2026-09-04T15:00:00.000Z'), 60_000);
    const second = store.acquire('tenant-1', 'delivery-1', new Date('2026-09-04T15:00:01.000Z'), 60_000);
    expect(first).toMatchObject({ acquired: true, token: 1 });
    expect(second).toEqual({ acquired: false });
  });

  it('increments the fencing token after lease expiry', () => {
    const createMemoryLeaseStore = Reflect.get(leases, 'createMemoryLeaseStore');
    expect(createMemoryLeaseStore).toBeTypeOf('function');
    const store = createMemoryLeaseStore();
    store.acquire('tenant-1', 'delivery-1', new Date('2026-09-04T15:00:00.000Z'), 1_000);
    expect(store.acquire('tenant-1', 'delivery-1', new Date('2026-09-04T15:00:02.000Z'), 1_000)).toMatchObject({ token: 2 });
  });

  it('rejects a commit from a stale fencing token', () => {
    const createMemoryLeaseStore = Reflect.get(leases, 'createMemoryLeaseStore');
    expect(createMemoryLeaseStore).toBeTypeOf('function');
    const store = createMemoryLeaseStore();
    store.acquire('tenant-1', 'delivery-1', new Date('2026-09-04T15:00:00.000Z'), 1_000);
    store.acquire('tenant-1', 'delivery-1', new Date('2026-09-04T15:00:02.000Z'), 1_000);
    expect(() => {
      store.commit('tenant-1', 'delivery-1', 1);
    }).toThrow('stale');
    expect(() => {
      store.commit('tenant-1', 'delivery-1', 2);
    }).not.toThrow();
  });
});
