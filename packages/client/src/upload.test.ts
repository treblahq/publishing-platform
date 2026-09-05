import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeliveryError, type ArtifactReference } from '@treblahq/publishing-contracts';

import { createArtifactUploader } from './upload.js';

const directories: string[] = [];
const reference = {
  id: 'video', storage: 'r2-temporary', sha256: 'a'.repeat(64), byteSize: 5,
  mediaType: 'video/mp4', locator: `temporary/troco/campaign/${'a'.repeat(64)}.mp4`,
} satisfies ArtifactReference;

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => rm(directory, {
    recursive: true, force: true,
  })));
});

async function mediaFile(bytes = 'media'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'publishing-upload-'));
  directories.push(directory);
  const path = join(directory, 'video.mp4');
  await writeFile(path, bytes);
  return path;
}

function uploader(fetch: typeof globalThis.fetch) {
  return createArtifactUploader({
    baseUrl: 'https://publish.example', clientId: 'troco-local', secret: 'test-secret', fetch,
    now: () => new Date('2026-09-05T12:00:00.000Z'), nonce: () => 'nonce-1',
  });
}

describe('temporary artifact uploader', () => {
  it('streams one signed content-addressed upload', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(
      { status: 'stored' }, { status: 201 },
    ));
    const path = await mediaFile();

    await expect(uploader(fetch).upload({ tenant: 'troco', reference, filePath: path }))
      .resolves.toEqual({ outcome: 'available', stored: true });

    expect(fetch).toHaveBeenCalledOnce();
    const call = fetch.mock.calls[0];
    if (!call) throw new Error('Expected an upload request');
    const [url, init] = call;
    const requestedUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    expect(requestedUrl).toContain('/v1/artifacts?');
    expect(requestedUrl).toContain('locator=temporary%2Ftroco%2Fcampaign');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBeTruthy();
    expect(new Headers(init?.headers).get('x-pub-content-sha256')).toBe(reference.sha256);
  });

  it('rejects a changed local file size before sending', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const path = await mediaFile('changed');

    await expect(uploader(fetch).upload({ tenant: 'troco', reference, filePath: path }))
      .rejects.toThrow('Artifact file size changed after preparation');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats an identical existing object as available', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(
      { status: 'already-available' }, { status: 200 },
    ));
    const path = await mediaFile();

    await expect(uploader(fetch).upload({ tenant: 'troco', reference, filePath: path }))
      .resolves.toEqual({ outcome: 'available', stored: false });
  });

  it('retains capacity deferral without retrying', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(
      { code: 'FREE_TIER_BUDGET_EXHAUSTED', retryAfter: '2026-09-06T00:00:00.000Z' },
      { status: 429 },
    ));
    const path = await mediaFile();

    await expect(uploader(fetch).upload({ tenant: 'troco', reference, filePath: path }))
      .resolves.toEqual({
        outcome: 'retry-later', code: 'FREE_TIER_BUDGET_EXHAUSTED',
        retryAfter: '2026-09-06T00:00:00.000Z',
      });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('exposes immutable locator conflicts as terminal failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(
      { code: 'ARTIFACT_CONFLICT' }, { status: 409 },
    ));
    const path = await mediaFile();

    const failure = uploader(fetch).upload({ tenant: 'troco', reference, filePath: path });
    await expect(failure).rejects.toMatchObject({ category: 'terminal', code: 'ARTIFACT_CONFLICT' });
    await expect(failure).rejects.toBeInstanceOf(DeliveryError);
  });
});
