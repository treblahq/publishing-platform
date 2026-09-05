import { describe, expect, it, vi } from 'vitest';
import { runAdapterConformance } from '@treblahq/publishing-adapter-kit';
import type { AdapterContext } from '@treblahq/publishing-adapter-kit';

import { createPagesAdapter, type PagesConfig, type PagesPayload } from './index.js';

const context = {
  tenant: 'openings', deliveryId: 'web-1', idempotencyKey: 'stable-web', operation: 'publish',
  config: { baseUrl: 'https://preview.pages.dev' },
  payload: { type: 'web.page', route: '/jobs/gh_123' }, artifacts: [],
} satisfies AdapterContext<PagesConfig, PagesPayload>;

describe('Cloudflare Pages verification adapter', () => {
  it('verifies the canonical route and passes adapter conformance', async () => {
    const request = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const adapter = createPagesAdapter({ request, now: () => new Date('2026-09-04T12:00:00.000Z') });
    await expect(runAdapterConformance(adapter, context)).resolves.toEqual({ remoteEffects: 1 });
    expect(request).toHaveBeenCalledWith('https://preview.pages.dev/jobs/gh_123', { method: 'GET', redirect: 'follow' });
  });

  it('reports absence without creating an external effect', async () => {
    const adapter = createPagesAdapter({ request: () => Promise.resolve(new Response('', { status: 404 })) });
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toEqual({ status: 'absent' });
  });

  it('classifies unavailable pages as retryable', async () => {
    const adapter = createPagesAdapter({ request: () => Promise.resolve(new Response('', { status: 503 })) });
    await expect(adapter.deliver(context)).rejects.toMatchObject({ category: 'retryable' });
  });
});
