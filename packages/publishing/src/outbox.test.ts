import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PublicationEnvelope } from './index.js';

import { createFileOutbox } from './outbox.js';

const directories: string[] = [];
const envelope = {
  schemaVersion: 1,
  identity: {
    tenant: 'openings',
    sourceType: 'job',
    sourceId: 'job-123',
    revision: 'rev-1',
    idempotencyKey: 'openings:job:job-123:rev-1',
  },
  canonical: { title: 'Engineer', language: 'en' },
  artifacts: [],
  deliveries: [{
    id: 'web', adapter: 'web.r2', operation: 'publish', required: true,
    payload: { type: 'web.page', route: '/jobs/job-123/' },
  }],
} satisfies PublicationEnvelope;

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('producer file outbox', () => {
  it('persists an envelope atomically before returning its entry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publishing-outbox-'));
    directories.push(directory);
    const outbox = createFileOutbox(directory);

    const entry = await outbox.enqueue(envelope);

    expect(await outbox.list()).toEqual([entry]);
    expect(JSON.parse(await readFile(entry.path, 'utf8'))).toEqual(envelope);
  });

  it('keeps retryable work and removes only an acknowledged entry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'publishing-outbox-'));
    directories.push(directory);
    const outbox = createFileOutbox(directory);
    const entry = await outbox.enqueue(envelope);

    expect(await outbox.list()).toHaveLength(1);
    await outbox.acknowledge(entry.id, 'pub-123');
    expect(await outbox.list()).toEqual([]);
  });
});
