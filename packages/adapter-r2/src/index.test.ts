import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { AdapterContext } from '@trebla/publishing-adapter-kit';
import type { WebEntityRevision } from '@trebla/publishing-contracts';

import { createR2WebAdapter, type R2WebConfig, type R2WebPayload } from './index.js';
import type { ActiveManifest, ActiveManifestStore, EntityObjectStore } from './activate.js';

class Objects implements EntityObjectStore {
  values = new Map<string, { bytes: Uint8Array; metadata: Record<string, string> }>();
  put(key: string, bytes: Uint8Array, metadata: Record<string, string>) {
    this.values.set(key, { bytes, metadata }); return Promise.resolve();
  }
  head(key: string) {
    const value = this.values.get(key);
    return Promise.resolve(value ? { size: value.bytes.byteLength, metadata: value.metadata } : null);
  }
  get(key: string) { return Promise.resolve(this.values.get(key)?.bytes ?? null); }
}

class Manifests implements ActiveManifestStore {
  values = new Map<string, ActiveManifest>();
  activate(entity: WebEntityRevision, objectKey: string) {
    this.values.set(`${entity.kind}:${entity.id}`, { ...entity, objectKey }); return Promise.resolve();
  }
  find(kind: WebEntityRevision['kind'], id: string) {
    return Promise.resolve(this.values.get(`${kind}:${id}`) ?? null);
  }
}

const content = { description: 'Build reliable systems' };
const entity: WebEntityRevision = {
  schemaVersion: 1,
  tenant: 'openings',
  kind: 'job',
  id: 'gh_123',
  revision: 'rev-1',
  canonicalPath: '/jobs/gh_123',
  title: 'Platform Engineer',
  summary: 'Build reliable systems',
  status: 'active',
  contentSha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
  content,
};
const context = {
  tenant: 'openings', deliveryId: 'web-1', idempotencyKey: 'stable', operation: 'publish',
  config: { publicBaseUrl: 'https://preview.pages.dev', canonicalBaseUrl: 'https://openings.dev' },
  payload: { type: 'web.page', entity }, artifacts: [],
} satisfies AdapterContext<R2WebConfig, R2WebPayload>;

describe('R2 web adapter', () => {
  it('activates verified content then verifies the public identity twice', async () => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      '<title>Platform Engineer | openings.dev</title><link rel="canonical" href="https://openings.dev/jobs/gh_123">',
      { status: 200 },
    )));
    const adapter = createR2WebAdapter({
      stores: { objects: new Objects(), manifests: new Manifests() }, request,
      now: () => new Date('2026-09-05T12:00:00.000Z'),
    });
    await expect(adapter.deliver(context)).resolves.toMatchObject({
      provider: 'web.r2', remoteId: 'openings:job:gh_123:rev-1',
      remoteUrl: 'https://preview.pages.dev/jobs/gh_123',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not verify a generic public shell after activation', async () => {
    const adapter = createR2WebAdapter({
      stores: { objects: new Objects(), manifests: new Manifests() },
      request: () => Promise.resolve(new Response('<title>Opportunity | openings.dev</title>', { status: 200 })),
    });
    await expect(adapter.deliver(context)).rejects.toMatchObject({
      code: 'R2_PUBLIC_ROUTE_NOT_READY', category: 'retryable',
    });
  });

  it('reconciles only the exact active revision', async () => {
    const stores = { objects: new Objects(), manifests: new Manifests() };
    const adapter = createR2WebAdapter({
      stores,
      request: () => Promise.resolve(new Response(
        '<title>Platform Engineer</title>https://openings.dev/jobs/gh_123', { status: 200 },
      )),
    });
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toEqual({ status: 'absent' });
    await adapter.deliver(context);
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toMatchObject({ status: 'found' });
  });
});
