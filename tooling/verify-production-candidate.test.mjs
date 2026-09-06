import { describe, expect, it, vi } from 'vitest';
import { verifyProductionCandidate } from './verify-production-candidate.mjs';

const responses = {
  '/health/live': () => Response.json({ status: 'live' }),
  '/admin/capacity': () => Response.json([
    { resource: 'd1Rows', percentOfFree: 1 },
    { resource: 'queueOperations', percentOfFree: 1 },
    { resource: 'r2Bytes', percentOfFree: 1 },
  ]),
  '/web/openings/jobs/gh_123': () => new Response(`<html><head><title>Engineer | openings.dev</title>
    <link rel="canonical" href="https://openings.dev/jobs/gh_123"></head></html>`, {
    headers: { 'x-publishing-revision': 'r1' },
  }),
};

function request(overrides = {}) {
  return vi.fn((url, init) => {
    expect(init.method).toBe('GET');
    const path = new URL(url).pathname;
    const response = overrides[path]?.() ?? responses[path]?.();
    return Promise.resolve(response ?? new Response('not found', { status: 404 }));
  });
}

const options = {
  baseUrl: 'https://publishing-platform-production.example.workers.dev',
  adminToken: 'secret',
  entityPath: '/web/openings/jobs/gh_123',
  expected: { title: 'Engineer | openings.dev', canonicalUrl: 'https://openings.dev/jobs/gh_123', revision: 'r1' },
};

describe('production candidate verification', () => {
  it('performs only bounded reads and returns sanitized evidence', async () => {
    const fetch = request();
    const result = await verifyProductionCandidate({ ...options, fetch });
    expect(result).toEqual({
      healthy: true, capacitySafe: true, entityVerified: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it.each([
    ['unhealthy Worker', { '/health/live': () => Response.json({ status: 'down' }, { status: 503 }) }],
    ['unsafe capacity', { '/admin/capacity': () => Response.json([{ resource: 'd1Rows', percentOfFree: 40 }]) }],
    ['wrong metadata', { '/web/openings/jobs/gh_123': () => new Response('<title>Wrong</title>') }],
  ])('rejects %s', async (_name, overrides) => {
    await expect(verifyProductionCandidate({ ...options, fetch: request(overrides) })).rejects.toThrow();
  });
});
