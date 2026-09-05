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

  it('does not expose an accidental catch-all route', async () => {
    const response = await createWorker().fetch(new Request('https://worker.test/unknown'), {});
    expect(response.status).toBe(404);
  });
});
