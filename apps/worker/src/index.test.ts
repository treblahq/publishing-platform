import { describe, expect, it, vi } from 'vitest';

import { createWorker } from './index.js';

describe('worker HTTP router', () => {
  it('serves web entities when Mastodon is configured with a Worker secret', async () => {
    const row = { kind: 'job', entity_id: 'gh_123', revision: 'r1', status: 'active',
      title: 'Engineer', canonical_path: '/jobs/gh_123', content_sha256: 'a'.repeat(64), object_key: 'entity.json' };
    const statement = { bind: () => statement, first: () => Promise.resolve(row) };
    const shell = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html><head><title>Shell</title></head><body></body></html>'));
    try {
      const response = await createWorker().fetch(new Request('https://worker.test/web/openings/jobs/gh_123'), {
        LEDGER: { prepare: () => statement }, ARTIFACTS: { head: () => Promise.resolve({ size: 1 }) },
        DELIVERY_QUEUE: {}, DELIVERY_DLQ: {},
        CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }),
        ENABLED_ADAPTERS: 'web.r2,social.shadow,social.mastodon',
        MASTODON_ACCESS_TOKENS: JSON.stringify({ openings: 'test-only-token' }),
        ADAPTER_CONFIGS: JSON.stringify({ openings: {
          'web.r2': { shellBaseUrl: 'https://openings-dev-web-dfy.pages.dev', canonicalBaseUrl: 'https://openings.dev' },
          'social.mastodon': { baseUrl: 'https://mastodon.social' },
        } }),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Engineer | openings.dev</title>');
      expect(shell).toHaveBeenCalledOnce();
      expect(shell.mock.calls[0]?.[0]).toEqual(new URL('https://openings-dev-web-dfy.pages.dev/route-indexes/jobs/'));
    } finally { shell.mockRestore(); }
  });

  it('keeps liveness independent from every durable binding', async () => {
    const response = await createWorker().fetch(new Request('https://worker.test/health/live'), {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'live' });
  });

  it('routes publication intake through runtime dependencies', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('accepted', { status: 202 }));
    const worker = createWorker({ publicationHandler: handler });
    const request = new Request('https://worker.test/v1/publications', { method: 'POST' });
    const response = await worker.fetch(request, { marker: true });
    expect(response.status).toBe(202);
    expect(handler).toHaveBeenCalledWith(request, { marker: true });
  });

  it('routes artifact uploads without waking delivery work', async () => {
    const artifactHandler = vi.fn().mockResolvedValue(new Response('stored', { status: 201 }));
    const scheduledHandler = vi.fn();
    const waitUntil = vi.fn();
    const worker = createWorker({ artifactHandler, scheduledHandler });
    const request = new Request('https://worker.test/v1/artifacts', { method: 'PUT' });

    const response = await worker.fetch(request, { marker: true }, { waitUntil } as unknown as ExecutionContext);

    expect(response.status).toBe(201);
    expect(artifactHandler).toHaveBeenCalledWith(request, { marker: true });
    expect(scheduledHandler).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('wakes the durable outbox immediately after accepted intake', async () => {
    const publicationHandler = vi.fn().mockResolvedValue(new Response('accepted', { status: 202 }));
    const scheduledHandler = vi.fn().mockResolvedValue(1);
    const waitUntil = vi.fn();
    const worker = createWorker({ publicationHandler, scheduledHandler });
    await worker.fetch(
      new Request('https://worker.test/v1/publications', { method: 'POST' }),
      { marker: true },
      { waitUntil } as unknown as ExecutionContext,
    );
    expect(scheduledHandler).toHaveBeenCalledWith({ marker: true });
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it('does not wake delivery work for rejected intake', async () => {
    const scheduledHandler = vi.fn();
    const waitUntil = vi.fn();
    const worker = createWorker({
      publicationHandler: () => Promise.resolve(new Response('invalid', { status: 400 })),
      scheduledHandler,
    });
    await worker.fetch(new Request('https://worker.test/v1/publications'), {}, { waitUntil } as unknown as ExecutionContext);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('does not expose an accidental catch-all route', async () => {
    const response = await createWorker().fetch(new Request('https://worker.test/unknown'), {});
    expect(response.status).toBe(404);
  });

  it('dispatches durable outbox work from the scheduled trigger', async () => {
    const scheduledHandler = vi.fn().mockResolvedValue(2);
    const waitUntil = vi.fn();
    createWorker({ scheduledHandler }).scheduled({} as ScheduledController, { marker: true }, { waitUntil } as unknown as ExecutionContext);
    expect(scheduledHandler).toHaveBeenCalledWith({ marker: true });
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBe(2);
  });

  it('routes queue batches through the durable consumer', async () => {
    const queueHandler = vi.fn().mockResolvedValue(undefined);
    const batch = { messages: [] } as unknown as MessageBatch;
    await createWorker({ queueHandler }).queue(batch, { marker: true });
    expect(queueHandler).toHaveBeenCalledWith(batch, { marker: true });
  });

  it('routes admin requests through authenticated runtime operations', async () => {
    const adminHandler = vi.fn().mockResolvedValue(Response.json({ ready: true }));
    const request = new Request('https://worker.test/admin/health/ready');
    const response = await createWorker({ adminHandler }).fetch(request, { marker: true });
    expect(response.status).toBe(200);
    expect(adminHandler).toHaveBeenCalledWith(request, { marker: true });
  });
});
