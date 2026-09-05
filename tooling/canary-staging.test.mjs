import { describe, expect, it, vi } from 'vitest';

import { runOneSignalCanary } from './canary-staging.mjs';

const envelope = {
  schemaVersion: 1,
  identity: { tenant: 'openings', sourceType: 'staging-canary', sourceId: 'job-1', revision: 'run-1', idempotencyKey: 'staging-canary:run-1' },
  canonical: { title: 'Canary', summary: 'Canary', canonicalUrl: 'https://openings.dev/jobs/job-1', language: 'pt-BR' },
  artifacts: [],
  deliveries: [],
};

describe('OneSignal staging canary', () => {
  it('resumes only for one publication and always pauses after both deliveries verify', async () => {
    const setAdapter = vi.fn().mockResolvedValue(undefined);
    const inspect = vi.fn()
      .mockResolvedValueOnce({ deliveries: [{ adapter: 'web.r2', state: 'verified' }, { adapter: 'push.onesignal', state: 'planned' }] })
      .mockResolvedValueOnce({ deliveries: [{ adapter: 'web.r2', state: 'verified' }, { adapter: 'push.onesignal', state: 'verified' }] });
    await expect(runOneSignalCanary({
      envelope,
      submit: () => Promise.resolve({ outcome: 'accepted', publicationId: 'publication-1' }),
      inspect,
      setAdapter,
      wait: () => Promise.resolve(),
    })).resolves.toEqual({ publicationId: 'publication-1' });
    expect(setAdapter.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it('pauses the adapter when submission fails', async () => {
    const setAdapter = vi.fn().mockResolvedValue(undefined);
    await expect(runOneSignalCanary({
      envelope,
      submit: () => Promise.reject(new Error('transport')),
      inspect: vi.fn(),
      setAdapter,
      wait: vi.fn(),
    })).rejects.toThrow('transport');
    expect(setAdapter.mock.calls.map((call) => call[0])).toEqual([true, false]);
  });

  it('fails closed when delivery does not verify before the deadline', async () => {
    const setAdapter = vi.fn().mockResolvedValue(undefined);
    await expect(runOneSignalCanary({
      envelope,
      submit: () => Promise.resolve({ outcome: 'accepted', publicationId: 'publication-1' }),
      inspect: () => Promise.resolve({ deliveries: [] }),
      setAdapter,
      wait: () => Promise.resolve(),
      attempts: 2,
    })).rejects.toThrow('did not verify');
    expect(setAdapter).toHaveBeenLastCalledWith(false);
  });
});
