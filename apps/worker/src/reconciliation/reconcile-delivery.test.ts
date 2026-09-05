import { describe, expect, it } from 'vitest';
import { createFakeAdapter } from '@treblahq/publishing-adapter-test';

import { createAdapterRegistry } from '../registry.js';
import { consumeDelivery } from '../delivery/consume.js';
import { createMemoryLeaseStore } from '../delivery/lease.js';
import { reconcileDelivery } from './reconcile-delivery.js';

const work = {
  tenant: 'openings', id: 'd1', adapter: 'test.fake', operation: 'publish',
  idempotencyKey: 'stable', config: {}, payload: { type: 'social.post' }, artifacts: [],
};

describe('delivery reconciler', () => {
  it('finds a lost provider response without creating a second effect', async () => {
    const adapter = createFakeAdapter({ faults: ['after-effect-before-response'] });
    const states: string[] = [];
    const dependencies = {
      registry: createAdapterRegistry([adapter], ['test.fake']),
      leases: createMemoryLeaseStore(),
      states: { commit: (_tenant: string, _id: string, _token: number, state: string) => { states.push(state); return Promise.resolve(); } },
      now: () => new Date('2026-09-04T12:00:00.000Z'),
    };
    await consumeDelivery(work, dependencies);
    await reconcileDelivery(work, dependencies);
    expect(states).toEqual(['reconciling', 'verified']);
    expect(adapter.effectCount()).toBe(1);
  });

  it('moves an unavailable reconciliation adapter to needs_attention', async () => {
    const states: string[] = [];
    await reconcileDelivery(work, {
      registry: createAdapterRegistry([], []), leases: createMemoryLeaseStore(),
      states: { commit: (_tenant, _id, _token, state) => { states.push(state); return Promise.resolve(); } },
      now: () => new Date('2026-09-04T12:00:00.000Z'),
    });
    expect(states).toEqual(['needs_attention']);
  });
});
