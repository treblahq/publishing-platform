import { describe, expect, it, vi } from 'vitest';

import { DeliveryError } from '@treblahq/publishing-contracts';
import type { AdapterContext } from '@treblahq/publishing-adapter-kit';
import { runAdapterConformance } from '@treblahq/publishing-adapter-kit';

import {
  createOneSignalAdapter,
  deriveOneSignalIdempotencyKey,
  type OneSignalConfig,
  type OneSignalPushPayload,
} from './index.js';

const now = new Date('2026-09-04T12:00:00.000Z');
const config = {
  appId: 'app-id',
  restApiKey: 'private-value',
  attestation: {
    observedMobileMau: 699,
    providerCeiling: 1_000,
    internalPause: 700,
    observedAt: '2026-09-04T10:00:00.000Z',
    expiresAt: '2026-09-11T10:00:00.000Z',
    evidenceHash: 'a'.repeat(64),
  },
};
const context = {
  tenant: 'openings',
  deliveryId: 'delivery-1',
  idempotencyKey: 'openings:job:42:push',
  operation: 'publish',
  config,
  payload: {
    type: 'push.notification',
    audience: { type: 'all-subscribers' },
    title: 'Nova vaga',
    body: 'Engenheiro de software',
    url: 'https://openings.dev/jobs/42',
  },
  artifacts: [],
} satisfies AdapterContext<OneSignalConfig, OneSignalPushPayload>;

describe('OneSignal adapter', () => {
  it('passes the mandatory adapter contract suite', async () => {
    const adapter = createOneSignalAdapter({
      send: () => Promise.resolve({ status: 200, body: { id: 'notification-1' } }),
      now: () => now,
    });
    await expect(runAdapterConformance(adapter, context)).resolves.toEqual({ remoteEffects: 1 });
  });

  it('broadcasts to every subscribed user with a stable RFC UUID', async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: { id: 'notification-1' } });
    const adapter = createOneSignalAdapter({ send, now: () => now });
    const first = await adapter.deliver(context);
    await adapter.deliver(context);
    const firstRequest = send.mock.calls[0]?.[0] as { body: Record<string, unknown> };
    const secondRequest = send.mock.calls[1]?.[0] as { body: Record<string, unknown> };
    expect(firstRequest.body.included_segments).toEqual(['Subscribed Users']);
    expect(firstRequest.body.idempotency_key).toBe(secondRequest.body.idempotency_key);
    expect(firstRequest.body.idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(first).toMatchObject({ provider: 'push.onesignal', remoteId: 'notification-1' });
  });

  it('derives different stable keys for different deliveries', async () => {
    await expect(deriveOneSignalIdempotencyKey('delivery-a')).resolves.not.toBe(
      await deriveOneSignalIdempotencyKey('delivery-b'),
    );
  });

  it.each([700, 1_000])('pauses before sending at %s observed MAU', async (observedMobileMau) => {
    const send = vi.fn();
    const adapter = createOneSignalAdapter({ send, now: () => now });
    await expect(adapter.deliver({
      ...context,
      config: { ...config, attestation: { ...config.attestation, observedMobileMau } },
    })).rejects.toMatchObject({ category: 'credential', code: 'ONESIGNAL_FREE_TIER_UNPROVEN' });
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed on an expired usage attestation', async () => {
    const adapter = createOneSignalAdapter({ send: vi.fn(), now: () => now });
    await expect(adapter.deliver({
      ...context,
      config: { ...config, attestation: { ...config.attestation, expiresAt: '2026-09-04T11:59:59.000Z' } },
    })).rejects.toBeInstanceOf(DeliveryError);
  });

  it('classifies a lost successful response as ambiguous without leaking credentials', async () => {
    const adapter = createOneSignalAdapter({
      send: () => Promise.resolve({ status: 200, body: { unexpected: true } }),
      now: () => now,
    });
    await expect(adapter.deliver(context)).rejects.toMatchObject({ category: 'ambiguous' });
    await expect(adapter.deliver(context)).rejects.not.toThrow('private-value');
  });
});
