import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runStagingSmoke, verifyStagingFailureGuards } from './smoke-staging.mjs';

test('submits a sanitized R2 publication and verifies its ledger record', async () => {
  const envelope = [];
  const result = await runStagingSmoke({
    runId: '123',
    submit: async (value) => {
      envelope.push(value);
      return { outcome: 'accepted', publicationId: 'publication-1' };
    },
    inspect: async (publicationId) => ({
      publication: { id: publicationId, state: 'accepted' },
      deliveries: [{ adapter: 'web.r2', state: 'ready' }],
    }),
    capacity: async () => [
      { resource: 'd1Rows', percentOfFree: 1.05, state: 'normal' },
      { resource: 'queueOperations', percentOfFree: 2, state: 'normal' },
      { resource: 'r2Bytes', percentOfFree: 0, state: 'normal' },
    ],
  });

  assert.equal(result.publicationId, 'publication-1');
  assert.equal(envelope[0].identity.tenant, 'openings');
  assert.equal(envelope[0].canonical.title, 'Staging smoke test');
  assert.deepEqual(envelope[0].artifacts, []);
  assert.deepEqual(envelope[0].deliveries.map((delivery) => delivery.adapter), ['web.r2']);
  assert.equal(envelope[0].deliveries[0].payload.route, '/jobs/staging-smoke-123');
  assert.equal(envelope[0].deliveries[0].payload.entity.kind, 'job');
});

test('rejects a missing ledger record or an unexpected adapter', async () => {
  const submit = async () => ({ outcome: 'accepted', publicationId: 'publication-1' });
  await assert.rejects(
    runStagingSmoke({
      runId: '123', submit, inspect: async () => ({ publication: null, deliveries: [] }), capacity: safeCapacity,
    }),
    /ledger/u,
  );
  await assert.rejects(
    runStagingSmoke({
      runId: '123',
      submit,
      inspect: async () => ({ publication: { id: 'publication-1' }, deliveries: [{ adapter: 'push.onesignal' }] }),
      capacity: safeCapacity,
    }),
    /R2-only/u,
  );
});

test('fails when capacity reaches the forty-percent staging gate', async () => {
  await assert.rejects(runStagingSmoke({
    runId: '123',
    submit: async () => ({ outcome: 'accepted', publicationId: 'publication-1' }),
    inspect: async () => ({ publication: { id: 'publication-1' }, deliveries: [{ adapter: 'web.r2' }] }),
    capacity: async () => [
      { resource: 'd1Rows', percentOfFree: 40, state: 'normal' },
      { resource: 'queueOperations', percentOfFree: 0, state: 'normal' },
      { resource: 'r2Bytes', percentOfFree: 0, state: 'normal' },
    ],
  }), /40%/u);
});

const safeCapacity = async () => [
  { resource: 'd1Rows', percentOfFree: 0, state: 'normal' },
  { resource: 'queueOperations', percentOfFree: 0, state: 'normal' },
  { resource: 'r2Bytes', percentOfFree: 0, state: 'normal' },
];

test('verifies authentication and validation failures without creating work', async () => {
  const calls = [];
  const statuses = [401, 400, 401];
  await verifyStagingFailureGuards({
    baseUrl: 'https://staging.invalid',
    secret: 'private-signing-secret-value',
    request: async (url, init) => {
      calls.push({ url, init });
      return new globalThis.Response('{}', { status: statuses.shift() });
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[1].init.headers['x-pub-client'], 'openings-preview');
  assert.match(calls[2].init.headers.authorization, /invalid/u);
});

test('fails when a staging guard accepts an invalid request', async () => {
  await assert.rejects(verifyStagingFailureGuards({
    baseUrl: 'https://staging.invalid',
    secret: 'private-signing-secret-value',
    request: async () => new globalThis.Response('{}', { status: 202 }),
  }), /guard/u);
});
