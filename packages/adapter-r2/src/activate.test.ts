import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { WebEntityRevision } from '@trebla/publishing-contracts';

import {
  stageAndActivateEntity,
  type ActiveManifest,
  type ActiveManifestStore,
  type EntityObjectStore,
} from './activate.js';

class MemoryObjects implements EntityObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; metadata: Record<string, string> }>();
  corruptRead = false;

  put(key: string, bytes: Uint8Array, metadata: Record<string, string>) {
    this.objects.set(key, { bytes, metadata });
    return Promise.resolve();
  }

  head(key: string) {
    const object = this.objects.get(key);
    return Promise.resolve(object ? { size: object.bytes.byteLength, metadata: object.metadata } : null);
  }

  get(key: string) {
    const bytes = this.objects.get(key)?.bytes ?? null;
    return Promise.resolve(bytes && this.corruptRead ? new TextEncoder().encode('corrupt') : bytes);
  }
}

class MemoryManifests implements ActiveManifestStore {
  readonly manifests = new Map<string, ActiveManifest>();

  activate(entity: WebEntityRevision, objectKey: string) {
    const key = `${entity.kind}:${entity.id}`;
    const current = this.manifests.get(key);
    if (current?.revision === entity.revision && current.contentSha256 !== entity.contentSha256) {
      throw new Error('Revision reuse has different content');
    }
    this.manifests.set(key, {
      kind: entity.kind,
      id: entity.id,
      revision: entity.revision,
      status: entity.status,
      contentSha256: entity.contentSha256,
      objectKey,
    });
    return Promise.resolve();
  }

  find(kind: WebEntityRevision['kind'], id: string) {
    return Promise.resolve(this.manifests.get(`${kind}:${id}`) ?? null);
  }
}

function fixture(overrides: Partial<WebEntityRevision> = {}): WebEntityRevision {
  const content = overrides.content ?? { company: 'Trebla' };
  const contentSha256 = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return {
    schemaVersion: 1,
    tenant: 'openings',
    kind: 'job',
    id: 'gh_123',
    revision: 'rev-1',
    canonicalPath: '/jobs/gh_123',
    title: 'Platform Engineer',
    status: 'active',
    contentSha256,
    content,
    ...overrides,
  };
}

describe('atomic entity activation', () => {
  it('stages verified bytes before activating the manifest', async () => {
    const objects = new MemoryObjects();
    const manifests = new MemoryManifests();
    const result = await stageAndActivateEntity(fixture(), { objects, manifests });

    expect(result.objectKey).toContain('/rev-1/');
    await expect(manifests.find('job', 'gh_123')).resolves.toMatchObject({ revision: 'rev-1' });
  });

  it('is idempotent for the same revision and hash', async () => {
    const stores = { objects: new MemoryObjects(), manifests: new MemoryManifests() };
    await stageAndActivateEntity(fixture(), stores);
    await expect(stageAndActivateEntity(fixture(), stores)).resolves.toBeDefined();
  });

  it('does not activate corrupted staged bytes', async () => {
    const objects = new MemoryObjects();
    objects.corruptRead = true;
    const manifests = new MemoryManifests();
    await expect(stageAndActivateEntity(fixture(), { objects, manifests })).rejects.toThrow('hash');
    await expect(manifests.find('job', 'gh_123')).resolves.toBeNull();
  });

  it('rejects revision reuse with different content', async () => {
    const stores = { objects: new MemoryObjects(), manifests: new MemoryManifests() };
    await stageAndActivateEntity(fixture(), stores);
    await expect(stageAndActivateEntity(fixture({ content: { company: 'Other' } }), stores))
      .rejects.toThrow('Revision reuse');
  });

  it('activates a minimal closed revision', async () => {
    const stores = { objects: new MemoryObjects(), manifests: new MemoryManifests() };
    await stageAndActivateEntity(fixture({ status: 'closed', content: { company: 'Trebla' } }), stores);
    await expect(stores.manifests.find('job', 'gh_123')).resolves.toMatchObject({ status: 'closed' });
  });
});
