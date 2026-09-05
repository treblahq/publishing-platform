import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicationEnvelope } from '@treblahq/publishing-contracts';

import type { PublishingClient } from './client.js';
import { createFileOutbox } from './outbox.js';
import { createLocalProducer } from './producer.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

function envelope(sourceId: string): PublicationEnvelope {
  return {
    schemaVersion: 1,
    identity: {
      tenant: 'troco', sourceType: 'campaign', sourceId, revision: 'rev-1',
      idempotencyKey: `troco:campaign:${sourceId}:rev-1`,
    },
    canonical: { title: `Campaign ${sourceId}`, language: 'pt-BR' },
    artifacts: [],
    deliveries: [{
      id: 'shadow', adapter: 'adapter.test', operation: 'publish', required: false,
      payload: { type: 'social.post', text: 'Conteúdo aprovado.' },
    }],
  };
}

async function outboxFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'publishing-producer-'));
  directories.push(directory);
  return createFileOutbox(directory);
}

describe('durable local producer', () => {
  it('prepares and persists an envelope without any network client', async () => {
    const outbox = await outboxFixture();
    const producer = createLocalProducer({ outbox });

    const entry = await producer.prepare(envelope('one'));

    expect(entry.envelope).toEqual(envelope('one'));
    await expect(outbox.list()).resolves.toEqual([entry]);
  });

  it('acknowledges only accepted entries and retains deferred or failed work', async () => {
    const outbox = await outboxFixture();
    await outbox.enqueue(envelope('accepted'));
    await outbox.enqueue(envelope('deferred'));
    await outbox.enqueue(envelope('failed'));
    const submit = vi.fn<PublishingClient['submit']>((value) => {
      if (value.identity.sourceId === 'accepted') {
        return Promise.resolve({ outcome: 'accepted', publicationId: 'pub-accepted' });
      }
      if (value.identity.sourceId === 'deferred') {
        return Promise.resolve({
          outcome: 'retry-later', code: 'CAPACITY_GUARD', retryAfter: 'tomorrow',
        });
      }
      return Promise.reject(new Error('offline'));
    });
    const producer = createLocalProducer({ outbox, client: { submit } });

    const result = await producer.drain({ limit: 3 });

    expect(result).toEqual({ attempted: 3, accepted: 1, deferred: 1, failed: 1, hasMore: true });
    expect((await outbox.list()).map((entry) => entry.envelope.identity.sourceId).sort())
      .toEqual(['deferred', 'failed']);
  });

  it('requires explicit network configuration before draining', async () => {
    const outbox = await outboxFixture();
    await outbox.enqueue(envelope('one'));

    await expect(createLocalProducer({ outbox }).drain({ limit: 1 }))
      .rejects.toThrow('Publishing client is required to drain the local outbox');
    await expect(outbox.list()).resolves.toHaveLength(1);
  });
});
