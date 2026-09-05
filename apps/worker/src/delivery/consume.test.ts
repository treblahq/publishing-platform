import { describe, expect, it } from 'vitest';

import { createFakeAdapter } from '@treblahq/publishing-adapter-test';
import { DeliveryError } from '@treblahq/publishing-contracts';

import { createMemoryLeaseStore } from './lease.js';
import { createAdapterRegistry } from '../registry.js';
import * as consumer from './consume.js';

const delivery = {
  tenant: 'openings', id: 'delivery-1', adapter: 'test.fake', operation: 'publish',
  idempotencyKey: 'stable-1', config: {}, payload: { type: 'social.post', text: 'Hello' }, artifacts: [],
};

function states() {
  const values: string[] = [];
  return { values, commit: (_tenant: string, _id: string, _token: number, state: string) => { values.push(state); return Promise.resolve(); } };
}

describe('duplicate-safe delivery consumer', () => {
  it('creates one provider effect for duplicate queue messages', async () => {
    const consumeDelivery = Reflect.get(consumer, 'consumeDelivery');
    expect(consumeDelivery).toBeTypeOf('function');
    const adapter = createFakeAdapter();
    const stateStore = states();
    const dependencies = { registry: createAdapterRegistry([adapter], ['test.fake']), leases: createMemoryLeaseStore(), states: stateStore, now: () => new Date('2026-09-04T15:00:00.000Z') };
    await consumeDelivery(delivery, dependencies);
    await consumeDelivery(delivery, dependencies);
    expect(adapter.effectCount()).toBe(1);
    expect(stateStore.values).toEqual(['verified', 'verified']);
  });

  it('moves unknown or disabled adapters to needs_attention without effects', async () => {
    const consumeDelivery = Reflect.get(consumer, 'consumeDelivery');
    expect(consumeDelivery).toBeTypeOf('function');
    const adapter = createFakeAdapter();
    const stateStore = states();
    await consumeDelivery(delivery, { registry: createAdapterRegistry([adapter], []), leases: createMemoryLeaseStore(), states: stateStore, now: () => new Date('2026-09-04T15:00:00.000Z') });
    expect(adapter.effectCount()).toBe(0);
    expect(stateStore.values).toEqual(['needs_attention']);
  });

  it.each([
    ['before-effect', 'retry_wait'],
    ['rate-limited', 'retry_wait'],
    ['after-effect-before-response', 'reconciling'],
    ['credential', 'needs_attention'],
    ['terminal', 'failed_terminal'],
  ] as const)('classifies %s as %s', async (fault, expectedState) => {
    const consumeDelivery = Reflect.get(consumer, 'consumeDelivery');
    expect(consumeDelivery).toBeTypeOf('function');
    const adapter = createFakeAdapter({ faults: [fault] });
    const stateStore = states();
    await consumeDelivery(delivery, { registry: createAdapterRegistry([adapter], ['test.fake']), leases: createMemoryLeaseStore(), states: stateStore, now: () => new Date('2026-09-04T15:00:00.000Z') });
    expect(stateStore.values).toEqual([expectedState]);
  });

  it('retries an ambiguous effect only when provider idempotency is enforced', async () => {
    const adapter = createFakeAdapter();
    const idempotentOnly = {
      ...adapter,
      manifest: { ...adapter.manifest, capabilities: { ...adapter.manifest.capabilities, reconciliation: false } },
      deliver: () => Promise.reject(new DeliveryError({
        code: 'LOST_RESPONSE', category: 'ambiguous', message: 'lost response',
      })),
    };
    const stateStore = states();
    await consumer.consumeDelivery(delivery, {
      registry: createAdapterRegistry([idempotentOnly], ['test.fake']),
      leases: createMemoryLeaseStore(), states: stateStore,
      now: () => new Date('2026-09-04T15:00:00.000Z'),
    });
    expect(stateStore.values).toEqual(['retry_wait']);
  });
});
