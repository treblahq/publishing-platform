import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hydrateProductionConfig } from './hydrate-production-config.mjs';

const publicConfig = {
  main: 'src/index.ts',
  env: {
    staging: {
      d1_databases: [{ database_id: '00000000-0000-0000-0000-000000000002' }],
    },
    production: {
      d1_databases: [{ database_id: '00000000-0000-0000-0000-000000000003' }],
    },
  },
};

test('hydrates only the production D1 identifier', () => {
  const hydrated = hydrateProductionConfig(
    publicConfig,
    { CLOUDFLARE_D1_DATABASE_ID: '75c6770b-a94e-4b15-8b84-f6af7e7d2afe' },
    '/repo/apps/worker',
  );

  assert.equal(hydrated.env.production.d1_databases[0].database_id, '75c6770b-a94e-4b15-8b84-f6af7e7d2afe');
  assert.equal(hydrated.main, '/repo/apps/worker/src/index.ts');
  assert.equal(hydrated.env.production.d1_databases[0].migrations_dir, '/repo/apps/worker/migrations');
  assert.equal(hydrated.env.staging.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000002');
  assert.equal(publicConfig.env.production.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000003');
});

test('rejects a missing or malformed production D1 identifier', () => {
  assert.throws(() => hydrateProductionConfig(publicConfig, {}), /CLOUDFLARE_D1_DATABASE_ID/u);
  assert.throws(
    () => hydrateProductionConfig(publicConfig, { CLOUDFLARE_D1_DATABASE_ID: 'not-a-uuid' }),
    /CLOUDFLARE_D1_DATABASE_ID/u,
  );
});
