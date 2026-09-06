import { describe, expect, it } from 'vitest';

import type { PublicationEnvelope } from '@trebla/publishing';

import * as intake from './accept-publication.js';

const envelope = {
  schemaVersion: 1,
  identity: {
    tenant: 'openings', sourceType: 'job', sourceId: 'job-1', revision: 'rev-1',
    idempotencyKey: 'openings:job:job-1:rev-1',
  },
  canonical: { title: 'Engineer', language: 'en' },
  artifacts: [],
  deliveries: [{
    id: 'web', adapter: 'web.pages', operation: 'publish', required: true,
    payload: { type: 'web.page', route: '/jobs/job-1' },
  }],
} satisfies PublicationEnvelope;

function createStore(existing: string | null = null) {
  const accepted: unknown[] = [];
  return {
    accepted,
    findByIdempotencyKey: () => Promise.resolve(existing),
    acceptAtomic: (value: unknown) => {
      accepted.push(value);
      return Promise.resolve('publication-new');
    },
  };
}

describe('atomic publication intake', () => {
  it('accepts a validated envelope exactly once', async () => {
    const acceptPublication = Reflect.get(intake, 'acceptPublication');
    expect(acceptPublication).toBeTypeOf('function');
    const store = createStore();
    await expect(acceptPublication({
      envelope, principal: { tenant: 'openings', clientId: 'client-1', nonce: 'nonce-1' },
      store, capacity: { accepted: true },
    })).resolves.toEqual({ outcome: 'accepted', publicationId: 'publication-new' });
    expect(store.accepted).toHaveLength(1);
  });

  it('returns the existing publication for a duplicate legitimate envelope', async () => {
    const acceptPublication = Reflect.get(intake, 'acceptPublication');
    expect(acceptPublication).toBeTypeOf('function');
    const store = createStore('publication-existing');
    await expect(acceptPublication({
      envelope, principal: { tenant: 'openings', clientId: 'client-1', nonce: 'nonce-2' },
      store, capacity: { accepted: false, retryAfter: '2026-09-05T00:00:00.000Z' },
    })).resolves.toEqual({ outcome: 'accepted', publicationId: 'publication-existing' });
    expect(store.accepted).toHaveLength(0);
  });

  it('rejects capacity before writing any accepted work', async () => {
    const acceptPublication = Reflect.get(intake, 'acceptPublication');
    expect(acceptPublication).toBeTypeOf('function');
    const store = createStore();
    await expect(acceptPublication({
      envelope, principal: { tenant: 'openings', clientId: 'client-1', nonce: 'nonce-1' },
      store, capacity: { accepted: false, retryAfter: '2026-09-05T00:00:00.000Z' },
    })).resolves.toMatchObject({ outcome: 'retry-later', publicationAccepted: false });
    expect(store.accepted).toHaveLength(0);
  });

  it('rejects an envelope for a different tenant', async () => {
    const acceptPublication = Reflect.get(intake, 'acceptPublication');
    expect(acceptPublication).toBeTypeOf('function');
    await expect(acceptPublication({
      envelope, principal: { tenant: 'troco', clientId: 'client-1', nonce: 'nonce-1' },
      store: createStore(), capacity: { accepted: true },
    })).rejects.toThrow('tenant');
  });
});
