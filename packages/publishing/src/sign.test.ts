import { describe, expect, it } from 'vitest';

import { canonicalRequest, signCanonicalRequest } from './sign.js';

const request = {
  method: 'post',
  path: '/v1/publications',
  tenant: 'openings',
  timestamp: '2026-09-04T15:00:00.000Z',
  nonce: '018f0000-0000-7000-8000-000000000001',
  bodySha256: 'a'.repeat(64),
};

describe('producer request signing', () => {
  it('builds one canonical representation', () => {
    expect(canonicalRequest(request)).toBe([
      'POST',
      '/v1/publications',
      'openings',
      '2026-09-04T15:00:00.000Z',
      '018f0000-0000-7000-8000-000000000001',
      'a'.repeat(64),
    ].join('\n'));
  });

  it('matches the independent HMAC-SHA256 fixed vector', async () => {
    await expect(signCanonicalRequest(request, 'test-secret')).resolves.toBe(
      'edbe17b8d10d699310201fd610e16012c0e41366f9189f842b9238c130bcd512',
    );
  });

  it('changes the signature when the body hash changes', async () => {
    const first = await signCanonicalRequest(request, 'test-secret');
    const second = await signCanonicalRequest({ ...request, bodySha256: 'b'.repeat(64) }, 'test-secret');
    expect(second).not.toBe(first);
  });
});
