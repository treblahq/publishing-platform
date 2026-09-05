import { describe, expect, it, vi } from 'vitest';

import { createWorker } from './index.js';

describe('worker HTTP router', () => {
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
