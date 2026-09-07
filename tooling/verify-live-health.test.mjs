import { describe, expect, it, vi } from 'vitest';
import { verifyLiveHealth } from './verify-live-health.mjs';

describe('live health verification', () => {
  it('tolerates bounded workers.dev propagation before accepting health', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new globalThis.Response('<!doctype html>', { status: 404 }))
      .mockResolvedValueOnce(globalThis.Response.json({ status: 'live' }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(verifyLiveHealth({ fetchImpl, sleep, delayMs: 1 })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it('fails after the bounded number of unhealthy responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new globalThis.Response('not ready', { status: 404 }));
    await expect(verifyLiveHealth({ fetchImpl, sleep: () => Promise.resolve(), attempts: 3, delayMs: 0 }))
      .rejects.toThrow('not live after 3 attempts');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
