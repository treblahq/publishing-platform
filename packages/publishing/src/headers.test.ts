import { describe, expect, it } from 'vitest';

import { buildSignedHeaders, buildSignedHeadersFromHash, sha256Hex } from './headers.js';

describe('signed producer headers', () => {
  it('signs an already verified body hash without requiring body bytes', async () => {
    const headers = await buildSignedHeadersFromHash({
      clientId: 'client-1', secret: 'secret', method: 'PUT',
      path: '/v1/artifacts?locator=temporary%2Ftroco%2Ffile&size=5&mediaType=video%2Fmp4',
      tenant: 'troco', timestamp: '2026-09-05T12:00:00.000Z', nonce: 'nonce-1',
      bodySha256: 'a'.repeat(64), contentType: 'video/mp4',
    });

    expect(headers['x-pub-content-sha256']).toBe('a'.repeat(64));
    expect(headers['content-type']).toBe('video/mp4');
    expect(headers['x-pub-signature']).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('hashes the exact UTF-8 request body', async () => {
    await expect(sha256Hex('{"title":"Olá"}')).resolves.toBe(
      '03e9c3e752dd891113602553f83f20aa91ea12cccaa43184e99468e1a2712476',
    );
  });

  it('binds client, tenant, timestamp, nonce, path, and body to the signature', async () => {
    const headers = await buildSignedHeaders({
      clientId: 'openings-actions',
      secret: 'test-secret',
      method: 'POST',
      path: '/v1/publications',
      tenant: 'openings',
      timestamp: '2026-09-04T15:00:00.000Z',
      nonce: '018f0000-0000-7000-8000-000000000001',
      body: '{"title":"Olá"}',
    });

    expect(headers).toEqual({
      'content-type': 'application/json',
      'x-pub-client': 'openings-actions',
      'x-pub-tenant': 'openings',
      'x-pub-timestamp': '2026-09-04T15:00:00.000Z',
      'x-pub-nonce': '018f0000-0000-7000-8000-000000000001',
      'x-pub-content-sha256': '03e9c3e752dd891113602553f83f20aa91ea12cccaa43184e99468e1a2712476',
      'x-pub-signature': 'e5371f2f4792a2c862aba09f8b8cd20511962f125fc1610f9880a90b7d4e05d8',
    });
  });
});
