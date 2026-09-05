import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareArtifactReference } from './artifacts.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

async function fixture(bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'publishing-artifact-'));
  directories.push(directory);
  const path = join(directory, 'clip.mp4');
  await writeFile(path, bytes);
  return path;
}

describe('local artifact preparation', () => {
  it('creates immutable temporary artifact metadata without uploading bytes', async () => {
    const path = await fixture(new TextEncoder().encode('media'));

    await expect(prepareArtifactReference({
      id: 'campaign-video',
      filePath: path,
      storage: 'r2-temporary',
      locator: 'temporary/troco/campaign-video.mp4',
      mediaType: 'video/mp4',
      allowedMediaTypes: ['video/mp4'],
      maxByteSize: 1024,
    })).resolves.toEqual({
      id: 'campaign-video',
      storage: 'r2-temporary',
      sha256: '721c9525ade2ea8903d343ef25cf68b9bf4ab0aad56bb7b01fbe48d09bc7fcf4',
      byteSize: 5,
      mediaType: 'video/mp4',
      locator: 'temporary/troco/campaign-video.mp4',
    });
  });

  it('rejects empty files', async () => {
    const path = await fixture(new Uint8Array());

    await expect(prepareArtifactReference({
      id: 'empty', filePath: path, storage: 'external', locator: 'file://empty',
      mediaType: 'video/mp4', allowedMediaTypes: ['video/mp4'], maxByteSize: 1024,
    })).rejects.toThrow('Artifact file must not be empty');
  });

  it('rejects media types outside the producer allowlist', async () => {
    const path = await fixture(new Uint8Array([1]));

    await expect(prepareArtifactReference({
      id: 'script', filePath: path, storage: 'external', locator: 'file://script',
      mediaType: 'application/javascript', allowedMediaTypes: ['video/mp4'], maxByteSize: 1024,
    })).rejects.toThrow('Artifact media type is not allowed');
  });

  it('rejects files beyond the producer byte limit before hashing', async () => {
    const path = await fixture(new Uint8Array([1, 2, 3]));

    await expect(prepareArtifactReference({
      id: 'large', filePath: path, storage: 'external', locator: 'file://large',
      mediaType: 'video/mp4', allowedMediaTypes: ['video/mp4'], maxByteSize: 2,
    })).rejects.toThrow('Artifact file exceeds the 2 byte limit');
  });
});
