import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runStagingSmoke } from './smoke-staging.mjs';

test('submits a sanitized Pages-only publication and verifies its ledger record', async () => {
  const envelope = [];
  const result = await runStagingSmoke({
    runId: '123',
    submit: async (value) => {
      envelope.push(value);
      return { outcome: 'accepted', publicationId: 'publication-1' };
    },
    inspect: async (publicationId) => ({
      publication: { id: publicationId, state: 'accepted' },
      deliveries: [{ adapter: 'web.pages', state: 'ready' }],
    }),
  });

  assert.equal(result.publicationId, 'publication-1');
  assert.equal(envelope[0].identity.tenant, 'openings');
  assert.equal(envelope[0].canonical.title, 'Staging smoke test');
  assert.deepEqual(envelope[0].artifacts, []);
  assert.deepEqual(envelope[0].deliveries.map((delivery) => delivery.adapter), ['web.pages']);
  assert.equal(envelope[0].deliveries[0].payload.route, '/');
});

test('rejects a missing ledger record or an unexpected adapter', async () => {
  const submit = async () => ({ outcome: 'accepted', publicationId: 'publication-1' });
  await assert.rejects(
    runStagingSmoke({ runId: '123', submit, inspect: async () => ({ publication: null, deliveries: [] }) }),
    /ledger/u,
  );
  await assert.rejects(
    runStagingSmoke({
      runId: '123',
      submit,
      inspect: async () => ({ publication: { id: 'publication-1' }, deliveries: [{ adapter: 'push.onesignal' }] }),
    }),
    /Pages-only/u,
  );
});
