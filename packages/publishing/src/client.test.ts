import { describe, expect, it, vi } from 'vitest';

import type { PublicationEnvelope } from './index.js';

import { createPublishingClient } from './client.js';

const envelope = {
  schemaVersion: 1,
  identity: {
    tenant: 'openings',
    sourceType: 'job',
    sourceId: 'job-123',
    revision: 'rev-1',
    idempotencyKey: 'openings:job:job-123:rev-1',
  },
  canonical: { title: 'Engineer', language: 'en' },
  artifacts: [],
  deliveries: [{
    id: 'web',
    adapter: 'web.r2',
    operation: 'publish',
    required: true,
    payload: { type: 'web.page', route: '/jobs/job-123/' },
  }],
} satisfies PublicationEnvelope;

describe('publishing client', () => {
  it('submits a validated signed envelope once', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      JSON.stringify({ publicationId: 'pub-123' }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    ));
    const client = createPublishingClient({
      baseUrl: 'https://publish.trebla.dev',
      clientId: 'openings-actions',
      secret: 'test-secret',
      fetch,
      now: () => new Date('2026-09-04T15:00:00.000Z'),
      nonce: () => '018f0000-0000-7000-8000-000000000001',
    });

    await expect(client.submit(envelope)).resolves.toEqual({
      outcome: 'accepted',
      publicationId: 'pub-123',
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe('https://publish.trebla.dev/v1/publications');
  });

  it('returns retained retry information without retrying a rejected intake', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        code: 'FREE_TIER_BUDGET_EXHAUSTED',
        publicationAccepted: false,
        retryAfter: '2026-09-05T00:05:00.000Z',
      }),
      { status: 429, headers: { 'retry-after': '2026-09-05T00:05:00.000Z' } },
    ));
    const client = createPublishingClient({
      baseUrl: 'https://publish.trebla.dev/',
      clientId: 'openings-actions',
      secret: 'test-secret',
      fetch,
    });

    await expect(client.submit(envelope)).resolves.toEqual({
      outcome: 'retry-later',
      code: 'FREE_TIER_BUDGET_EXHAUSTED',
      retryAfter: '2026-09-05T00:05:00.000Z',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
