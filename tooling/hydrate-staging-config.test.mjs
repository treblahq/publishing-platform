import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hydrateStagingConfig } from './hydrate-staging-config.mjs';

const publicConfig = {
  env: {
    staging: {
      d1_databases: [{ database_id: '00000000-0000-0000-0000-000000000002' }],
    },
    production: {
      d1_databases: [{ database_id: '00000000-0000-0000-0000-000000000003' }],
    },
  },
};

test('hydrates only the staging D1 identifier from the deployment environment', () => {
  const hydrated = hydrateStagingConfig(publicConfig, {
    CLOUDFLARE_D1_DATABASE_ID: '75c6770b-a94e-4b15-8b84-f6af7e7d2afe',
  });

  assert.equal(hydrated.env.staging.d1_databases[0].database_id, '75c6770b-a94e-4b15-8b84-f6af7e7d2afe');
  assert.equal(hydrated.env.production.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000003');
  assert.equal(publicConfig.env.staging.d1_databases[0].database_id, '00000000-0000-0000-0000-000000000002');
});

test('rejects a missing or malformed staging D1 identifier', () => {
  assert.throws(() => hydrateStagingConfig(publicConfig, {}), /CLOUDFLARE_D1_DATABASE_ID/u);
  assert.throws(
    () => hydrateStagingConfig(publicConfig, { CLOUDFLARE_D1_DATABASE_ID: 'not-a-uuid' }),
    /CLOUDFLARE_D1_DATABASE_ID/u,
  );
});
