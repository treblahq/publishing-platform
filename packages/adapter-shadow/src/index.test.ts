import { describe, expect, it } from 'vitest';

import type { AdapterContext } from '@trebla/publishing-adapter-kit';

import { createSocialShadowAdapter, type SocialShadowPayload } from './index.js';

const context = {
  tenant: 'openings',
  deliveryId: 'delivery-social',
  idempotencyKey: 'openings:job:42:social',
  operation: 'compare',
  config: {},
  payload: {
    type: 'social.post',
    text: 'A new role is available.',
    artifactIds: ['media-a'],
  },
  artifacts: [],
} satisfies AdapterContext<Record<string, never>, SocialShadowPayload>;

describe('social shadow adapter', () => {
  it('validates without a provider and returns a deterministic verified receipt', async () => {
    const adapter = createSocialShadowAdapter({ now: () => new Date('2026-09-07T04:00:00.000Z') });

    await expect(adapter.validate(context)).resolves.toEqual({ valid: true });
    const first = await adapter.deliver(context);
    const second = await adapter.deliver(context);

    expect(first).toEqual(second);
    expect(first.provider).toBe('social.shadow');
    expect(first.remoteId).toMatch(/^shadow:[a-f0-9]{64}$/u);
    await expect(adapter.reconcile({ ...context, receipt: first }))
      .resolves.toEqual({ status: 'found', receipt: first });
    await expect(adapter.artifactRetention?.({
      tenant: context.tenant,
      deliveryId: context.deliveryId,
      artifact: {
        id: 'media-a', storage: 'r2-temporary', sha256: 'a'.repeat(64), byteSize: 1,
        mediaType: 'image/png', locator: 'temporary/openings/job/media.png',
      },
      receipt: first,
    })).resolves.toEqual({ safeToDelete: false, reason: 'shadow-has-no-provider-ingestion' });
  });

  it.each([
    ['wrong payload type', { ...context.payload, type: 'video.upload' }],
    ['empty text', { ...context.payload, text: '   ' }],
    ['missing artifact IDs', { type: 'social.post', text: 'Post' }],
    ['empty artifact IDs', { ...context.payload, artifactIds: [] }],
  ])('rejects %s', async (_label, payload) => {
    const adapter = createSocialShadowAdapter();
    await expect(adapter.validate({ ...context, payload } as typeof context))
      .resolves.toMatchObject({ valid: false });
    await expect(adapter.deliver({ ...context, payload } as typeof context))
      .rejects.toMatchObject({ category: 'terminal', code: 'SOCIAL_SHADOW_INVALID_PAYLOAD' });
  });

  it('rejects unsupported operations', async () => {
    const adapter = createSocialShadowAdapter();
    await expect(adapter.deliver({ ...context, operation: 'publish' }))
      .rejects.toMatchObject({ category: 'terminal', code: 'SOCIAL_SHADOW_INVALID_PAYLOAD' });
  });
});
