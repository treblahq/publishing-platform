import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as command from './producer-submit.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it('requires an explicit tenant and outbox for a single submission', () => {
  expect(command.parseProducerSubmitArguments(['handoff.json', '--tenant', 'equity', '--outbox', '.publishing']))
    .toEqual({ handoffPath: 'handoff.json', tenant: 'equity', outboxDirectory: '.publishing' });
  expect(() => command.parseProducerSubmitArguments(['handoff.json'])).toThrow('Usage');
});

it('rejects cross-tenant and live-provider handoffs before using credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'producer-submit-'));
  directories.push(directory);
  const handoffPath = join(directory, 'handoff.json');
  const handoff = { envelope: { schemaVersion: 1,
    identity: { tenant: 'equity', sourceType: 'production', sourceId: 'one', revision: 'one', idempotencyKey: 'equity:one:one' },
    canonical: { title: 'Approved', language: 'en' }, artifacts: [],
    deliveries: [{ id: 'shadow', adapter: 'social.shadow', operation: 'compare', required: false, payload: { type: 'social.post', text: 'Approved' } }],
  }, uploads: [] };
  await writeFile(handoffPath, JSON.stringify(handoff));
  await expect(command.submitProducerHandoff({ handoffPath, tenant: 'troco', outboxDirectory: directory }, {}))
    .rejects.toThrow('tenant');
  for (const delivery of handoff.envelope.deliveries) delivery.adapter = 'social.mastodon';
  await writeFile(handoffPath, JSON.stringify(handoff));
  await expect(command.submitProducerHandoff({ handoffPath, tenant: 'equity', outboxDirectory: directory }, {}))
    .rejects.toThrow('shadow');
});

it('submits exactly one authenticated handoff without an admin credential', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'producer-submit-'));
  directories.push(directory);
  const handoffPath = join(directory, 'handoff.json');
  await writeFile(handoffPath, JSON.stringify({ envelope: { schemaVersion: 1,
    identity: { tenant: 'trebla', sourceType: 'story', sourceId: 'one', revision: 'one', idempotencyKey: 'trebla:one:one' },
    canonical: { title: 'Approved', language: 'pt-BR' }, artifacts: [],
    deliveries: [{ id: 'shadow', adapter: 'social.shadow', operation: 'compare', required: false, payload: { type: 'social.post', text: 'Approved' } }],
  }, uploads: [] }));
  const calls: string[] = [];
  const result = await command.submitProducerHandoff({ handoffPath, tenant: 'trebla', outboxDirectory: directory }, {
    PUBLISHING_ENDPOINT: 'https://publisher.example', PUBLISHING_CLIENT_ID: 'trebla', PUBLISHING_CLIENT_SECRET: 'local-test-only',
  }, (_url, init) => {
    calls.push(init?.method ?? 'GET');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    return Promise.resolve(Response.json({ publicationId: 'one' }));
  });
  expect(result).toEqual({ outcome: 'accepted', publicationId: 'one' });
  expect(calls).toEqual(['POST']);
});
