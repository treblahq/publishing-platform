import { describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { buildSignedHeaders } from '@trebla/publishing';
import type { PublicationEnvelope } from '@trebla/publishing';

import * as routes from './routes.js';
import { createD1IntakeStore } from './d1-intake-store.js';
import { acceptPublication } from './accept-publication.js';

const envelope = {
  schemaVersion: 1,
  identity: { tenant: 'openings', sourceType: 'job', sourceId: 'job-1', revision: 'rev-1', idempotencyKey: 'idem-1' },
  canonical: { title: 'Engineer', language: 'en' }, artifacts: [],
  deliveries: [{ id: 'web', adapter: 'web.pages', operation: 'publish', required: true, payload: { type: 'web.page', route: '/jobs/job-1' } }],
} satisfies PublicationEnvelope;

async function requestFor(value: unknown = envelope) {
  const body = JSON.stringify(value);
  const headers = await buildSignedHeaders({ clientId: 'client-1', secret: 'test-secret', method: 'POST', path: '/v1/publications', tenant: 'openings', timestamp: '2026-09-04T15:00:00.000Z', nonce: 'nonce-1', body });
  return new Request('https://publish.example/v1/publications', { method: 'POST', body, headers });
}

const client = { id: 'client-1', tenant: 'openings', enabled: true, secret: 'test-secret' };

describe('publication intake route', () => {
  it.each(['same', 'content', 'producer'] as const)('checks durable acceptance ownership and immutable content: %s', async (variant) => {
    const database = new DatabaseSync(':memory:');
    const temporaryEnvelope: PublicationEnvelope = { ...envelope, artifacts: [{
      id: 'video', storage: 'r2-temporary', sha256: 'a'.repeat(64), byteSize: 5,
      mediaType: 'video/mp4', locator: `temporary/openings/job/${'a'.repeat(64)}.mp4`,
    }] };
    database.exec('CREATE TABLE publications (id TEXT, tenant_id TEXT, idempotency_key TEXT, producer_client_id TEXT, envelope_json TEXT)');
    database.prepare('INSERT INTO publications VALUES (?, ?, ?, ?, ?)').run(
      'private-publication-id', 'openings', 'idem-1', variant === 'producer' ? 'another-producer' : client.id,
      JSON.stringify(variant === 'content' ? { ...temporaryEnvelope, canonical: { ...envelope.canonical, title: 'Different' } } : temporaryEnvelope),
    );
    let effects = 0;
    const store = createD1IntakeStore({
      prepare(sql) {
        let bindings: SQLInputValue[] = [];
        return {
          bind(...values: unknown[]) { bindings = values as SQLInputValue[]; return this; },
          first<T>() { return Promise.resolve(database.prepare(sql).get(...bindings) as T | undefined ?? null); },
        };
      },
      batch() { effects += 1; return Promise.resolve([]); },
    });
    try {
      const response = await routes.handlePublicationRequest(await requestFor(temporaryEnvelope), {
        now: () => new Date('2026-09-04T15:00:00.000Z'), loadClient: () => Promise.resolve(client),
        capacity: () => { effects += 1; return Promise.resolve({ accepted: false, retryAfter: 'tomorrow' }); },
        artifactsReady: () => { effects += 1; return Promise.resolve(false); },
        store,
      });
      expect(response.status).toBe(variant === 'same' ? 202 : 409);
      await expect(response.json()).resolves.toEqual(variant === 'same'
        ? { publicationId: 'private-publication-id' } : { code: 'PUBLICATION_CONFLICT' });
      const direct = acceptPublication({
        envelope: temporaryEnvelope, principal: { tenant: client.tenant, clientId: client.id, nonce: 'fresh-nonce' },
        store, capacity: { accepted: false, retryAfter: 'tomorrow' },
      });
      if (variant === 'same') {
        await expect(direct).resolves.toEqual({ outcome: 'accepted', publicationId: 'private-publication-id' });
      } else {
        await expect(direct).rejects.toThrow('Publication identity conflicts with accepted work');
      }
      expect(effects).toBe(0);
    } finally {
      database.close();
    }
  });
  it('returns 202 with the durable publication id', async () => {
    const handlePublicationRequest = Reflect.get(routes, 'handlePublicationRequest');
    expect(handlePublicationRequest).toBeTypeOf('function');
    const response = await handlePublicationRequest(await requestFor(), {
      now: () => new Date('2026-09-04T15:00:00.000Z'), loadClient: () => Promise.resolve(client),
      capacity: () => Promise.resolve({ accepted: true }),
      artifactsReady: () => Promise.resolve(true),
      store: { findByIdempotencyKey: () => Promise.resolve(null), acceptAtomic: () => Promise.resolve('publication-1') },
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ publicationId: 'publication-1' });
  });

  it('returns explicit 429 without accepting work', async () => {
    const handlePublicationRequest = Reflect.get(routes, 'handlePublicationRequest');
    expect(handlePublicationRequest).toBeTypeOf('function');
    let writes = 0;
    const response = await handlePublicationRequest(await requestFor(), {
      now: () => new Date('2026-09-04T15:00:00.000Z'), loadClient: () => Promise.resolve(client),
      capacity: () => Promise.resolve({ accepted: false, retryAfter: '2026-09-05T00:00:00.000Z' }),
      artifactsReady: () => Promise.resolve(true),
      store: { findByIdempotencyKey: () => Promise.resolve(null), acceptAtomic: () => { writes += 1; return Promise.resolve('unexpected'); } },
    });
    expect(response.status).toBe(429);
    expect(writes).toBe(0);
    await expect(response.json()).resolves.toMatchObject({ publicationAccepted: false });
  });

  it('rejects an invalid signature without invoking capacity or storage', async () => {
    const handlePublicationRequest = Reflect.get(routes, 'handlePublicationRequest');
    expect(handlePublicationRequest).toBeTypeOf('function');
    const request = await requestFor();
    request.headers.set('x-pub-signature', '0'.repeat(64));
    let effects = 0;
    const response = await handlePublicationRequest(request, {
      now: () => new Date('2026-09-04T15:00:00.000Z'), loadClient: () => Promise.resolve(client),
      capacity: () => { effects += 1; return Promise.resolve({ accepted: true }); },
      artifactsReady: () => { effects += 1; return Promise.resolve(true); },
      store: { findByIdempotencyKey: () => Promise.resolve(null), acceptAtomic: () => { effects += 1; return Promise.resolve('unexpected'); } },
    });
    expect(response.status).toBe(401);
    expect(effects).toBe(0);
  });

  it('rejects a publication before capacity or storage when temporary bytes are unavailable', async () => {
    const handlePublicationRequest = Reflect.get(routes, 'handlePublicationRequest');
    expect(handlePublicationRequest).toBeTypeOf('function');
    let effects = 0;
    const temporary = {
      ...envelope,
      artifacts: [{
        id: 'video', storage: 'r2-temporary' as const, sha256: 'a'.repeat(64),
        byteSize: 5, mediaType: 'video/mp4',
        locator: `temporary/openings/job/${'a'.repeat(64)}.mp4`,
      }],
    } satisfies PublicationEnvelope;
    const response = await handlePublicationRequest(await requestFor(temporary), {
      now: () => new Date('2026-09-04T15:00:00.000Z'),
      loadClient: () => Promise.resolve(client),
      artifactsReady: () => Promise.resolve(false),
      capacity: () => { effects += 1; return Promise.resolve({ accepted: true }); },
      store: {
        findByIdempotencyKey: () => Promise.resolve(null),
        acceptAtomic: () => { effects += 1; return Promise.resolve('unexpected'); },
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ code: 'ARTIFACT_NOT_READY' });
    expect(effects).toBe(0);
  });
});
