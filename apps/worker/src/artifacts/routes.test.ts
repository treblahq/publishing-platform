import { describe, expect, it, vi } from 'vitest';

import { buildSignedHeadersFromHash } from '@trebla/publishing';

import { handleArtifactUploadRequest } from './routes.js';

const now = new Date('2026-09-05T12:00:00.000Z');
const sha256 = 'a'.repeat(64);
const locator = `temporary/troco/campaign/${sha256}.mp4`;
const path = `/v1/artifacts?${new URLSearchParams({
  locator, size: '5', mediaType: 'video/mp4',
}).toString()}`;
const client = { id: 'troco-local', tenant: 'troco', enabled: true, secret: 'test-secret' };

async function uploadRequest(overrides: { path?: string; secret?: string } = {}) {
  const requestPath = overrides.path ?? path;
  const headers = await buildSignedHeadersFromHash({
    clientId: client.id, secret: overrides.secret ?? client.secret, method: 'PUT',
    path: requestPath, tenant: client.tenant, timestamp: now.toISOString(), nonce: 'nonce-1',
    bodySha256: sha256, contentType: 'video/mp4',
  });
  return new Request(`https://publish.example${requestPath}`, {
    method: 'PUT', headers, body: 'media',
  });
}

function checksum(value: string): ArrayBuffer {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)).buffer;
}

function dependencies(reservation: 'reserved' | 'already-available' = 'reserved') {
  const object = {
    size: 5,
    customMetadata: { sha256, tenant: 'troco', mediaType: 'video/mp4' },
    checksums: { sha256: checksum(sha256) },
  };
  return {
    now: () => now,
    loadClient: () => Promise.resolve(client),
    uploads: {
      reserve: vi.fn().mockResolvedValue({ outcome: reservation, uploadId: 'upload-1' }),
      markAvailable: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    },
    bucket: {
      put: vi.fn().mockResolvedValue(object),
      head: vi.fn().mockResolvedValue(object),
    },
  };
}

describe('temporary artifact upload route', () => {
  it('streams bytes through R2 checksum validation before marking available', async () => {
    const deps = dependencies();
    const response = await handleArtifactUploadRequest(await uploadRequest(), deps);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ status: 'stored' });
    expect(deps.bucket.put).toHaveBeenCalledWith(locator, expect.anything(), {
      sha256,
      httpMetadata: { contentType: 'video/mp4' },
      customMetadata: { sha256, tenant: 'troco', mediaType: 'video/mp4' },
    });
    expect(deps.uploads.markAvailable).toHaveBeenCalledWith('troco', 'upload-1', now);
  });

  it('returns an identical verified object without writing it twice', async () => {
    const deps = dependencies('already-available');
    const response = await handleArtifactUploadRequest(await uploadRequest(), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'already-available' });
    expect(deps.bucket.put).not.toHaveBeenCalled();
  });

  it('rejects unsigned or malformed upload metadata before reservation', async () => {
    const deps = dependencies();
    const badPath = '/v1/artifacts?locator=temporary%2Fother%2Ffile.mp4&size=5&mediaType=video%2Fmp4';
    const response = await handleArtifactUploadRequest(await uploadRequest({ path: badPath }), deps);

    expect(response.status).toBe(400);
    expect(deps.uploads.reserve).not.toHaveBeenCalled();
  });

  it('rejects a bad signature before reservation or R2 access', async () => {
    const deps = dependencies();
    const request = await uploadRequest({ secret: 'wrong-secret' });
    const response = await handleArtifactUploadRequest(request, deps);

    expect(response.status).toBe(401);
    expect(deps.uploads.reserve).not.toHaveBeenCalled();
    expect(deps.bucket.put).not.toHaveBeenCalled();
  });

  it('fails closed on capacity reservation rejection', async () => {
    const deps = dependencies();
    deps.uploads.reserve.mockRejectedValue(new Error('free-tier capacity reservation rejected'));
    const response = await handleArtifactUploadRequest(await uploadRequest(), deps);

    expect(response.status).toBe(429);
    expect(deps.bucket.put).not.toHaveBeenCalled();
  });

  it('releases failed upload state after R2 checksum rejection', async () => {
    const deps = dependencies();
    deps.bucket.put.mockRejectedValue(new Error('checksum mismatch'));
    const response = await handleArtifactUploadRequest(await uploadRequest(), deps);

    expect(response.status).toBe(422);
    expect(deps.uploads.markFailed).toHaveBeenCalledWith('troco', 'upload-1', now);
  });
});
