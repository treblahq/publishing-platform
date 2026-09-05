import { describe, expect, it, vi } from 'vitest';

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
  const dueDates: Array<string | undefined> = [];
  const safeArtifacts: string[][] = [];
  return { values, dueDates, safeArtifacts, commit: (_tenant: string, _id: string, _token: number, state: string, _receipt?: unknown, dueAt?: string, safeIds: readonly string[] = []) => {
    values.push(state); dueDates.push(dueAt); safeArtifacts.push([...safeIds]); return Promise.resolve();
  } };
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

  it('does not call a provider again after a durable terminal success', async () => {
    const adapter = createFakeAdapter();
    const deliver = vi.spyOn(adapter, 'deliver');
    await consumer.consumeDelivery({ ...delivery, state: 'verified' }, {
      registry: createAdapterRegistry([adapter], ['test.fake']),
      leases: createMemoryLeaseStore(), states: states(),
      now: () => new Date('2026-09-04T15:00:00.000Z'),
    });
    expect(deliver).not.toHaveBeenCalled();
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

  it('rejects an undeclared adapter operation before any provider effect', async () => {
    const adapter = createFakeAdapter();
    const stateStore = states();
    await consumer.consumeDelivery({ ...delivery, operation: 'delete' }, {
      registry: createAdapterRegistry([adapter], ['test.fake']),
      leases: createMemoryLeaseStore(), states: stateStore,
      now: () => new Date('2026-09-04T15:00:00.000Z'),
    });
    expect(adapter.effectCount()).toBe(0);
    expect(stateStore.values).toEqual(['failed_terminal']);
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

  it('preserves an exact provider retry time for rate limits', async () => {
    const adapter = createFakeAdapter();
    const rateLimited = {
      ...adapter,
      deliver: () => Promise.reject(new DeliveryError({
        code: 'RATE_LIMIT', category: 'rate-limited', message: 'slow down',
        retryAfter: '2026-09-04T15:07:00.000Z',
      })),
    };
    const stateStore = states();
    await consumer.consumeDelivery(delivery, {
      registry: createAdapterRegistry([rateLimited], ['test.fake']),
      leases: createMemoryLeaseStore(), states: stateStore,
      now: () => new Date('2026-09-04T15:00:00.000Z'),
    });
    expect(stateStore.dueDates).toEqual(['2026-09-04T15:07:00.000Z']);
  });

  it('reports credential failures for an automatic tenant-scoped pause', async () => {
    const adapter = createFakeAdapter({ faults: ['credential'] });
    const record = vi.fn().mockResolvedValue(undefined);
    await consumer.consumeDelivery(delivery, {
      registry: createAdapterRegistry([adapter], ['test.fake']),
      leases: createMemoryLeaseStore(), states: states(), failures: { record },
      now: () => new Date('2026-09-04T15:00:00.000Z'),
    });
    expect(record).toHaveBeenCalledWith('openings', 'test.fake', 'credential', 'FAKE_CREDENTIAL');
  });

  it('records the adapter deletion gate only after verified delivery', async () => {
    const adapter = createFakeAdapter();
    const stateStore = states();
    await consumer.consumeDelivery({
      ...delivery,
      artifacts: [{ id: 'artifact-1', storage: 'r2-temporary', sha256: 'a'.repeat(64), byteSize: 10, mediaType: 'image/png', locator: 'objects/a' }],
    }, {
      registry: createAdapterRegistry([adapter], ['test.fake']),
      leases: createMemoryLeaseStore(), states: stateStore,
      now: () => new Date('2026-09-04T15:00:00.000Z'),
    });
    expect(stateStore.safeArtifacts).toEqual([['artifact-1']]);
  });
});
