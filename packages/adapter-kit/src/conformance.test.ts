import { describe, expect, it } from 'vitest';

import { runAdapterConformance } from './index.js';

describe('adapter conformance harness', () => {
  it('requires deterministic validation and duplicate-safe delivery', async () => {
    const effects = new Map<string, { provider: string; remoteId: string; acceptedAt: string }>();
    const adapter = {
      manifest: {
        contractVersion: 1,
        name: 'test.fake',
        channels: ['social.post'],
        operations: ['publish'],
        capabilities: {
          providerIdempotency: true,
          reconciliation: true,
          asynchronousIngestion: false,
        },
      },
      validate: () => Promise.resolve({ valid: true as const }),
      deliver: (context: { idempotencyKey: string }) => {
        const receipt = effects.get(context.idempotencyKey) ?? {
          provider: 'test.fake',
          remoteId: `remote:${context.idempotencyKey}`,
          acceptedAt: '2026-09-04T00:00:00.000Z',
        };
        effects.set(context.idempotencyKey, receipt);
        return Promise.resolve(receipt);
      },
      reconcile: (context: { receipt: unknown }) => Promise.resolve({
        status: 'found' as const,
        receipt: context.receipt,
      }),
    };

    await expect(runAdapterConformance(adapter as Parameters<typeof runAdapterConformance>[0], {
      tenant: 'openings',
      deliveryId: 'delivery-1',
      idempotencyKey: 'stable-1',
      operation: 'publish',
      config: {},
      payload: { type: 'social.post', text: 'Hello' },
      artifacts: [],
    })).resolves.toMatchObject({ remoteEffects: 1 });
    expect(effects.size).toBe(1);
  });

  it('rejects nondeterministic adapter validation', async () => {
    let valid = false;
    const adapter = {
      manifest: {
        contractVersion: 1,
        name: 'test.unstable',
        channels: ['social.post'],
        operations: ['publish'],
        capabilities: {
          providerIdempotency: true,
          reconciliation: false,
          asynchronousIngestion: false,
        },
      },
      validate: () => Promise.resolve({ valid: (valid = !valid) }),
      deliver: () => Promise.resolve({
        provider: 'test.unstable',
        remoteId: 'remote-1',
        acceptedAt: '2026-09-04T00:00:00.000Z',
      }),
      reconcile: () => Promise.resolve({ status: 'unknown' as const }),
    };

    await expect(runAdapterConformance(adapter as Parameters<typeof runAdapterConformance>[0], {
      tenant: 'openings',
      deliveryId: 'delivery-1',
      idempotencyKey: 'stable-1',
      operation: 'publish',
      config: {},
      payload: { type: 'social.post', text: 'Hello' },
      artifacts: [],
    })).rejects.toThrow('deterministic');
  });
});
