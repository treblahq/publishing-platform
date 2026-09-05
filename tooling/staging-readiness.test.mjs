import { describe, expect, it } from 'vitest';
import { assertStagingReady } from './staging-readiness.mjs';

function config(databaseId = '11111111-2222-4333-8444-555555555555') {
  return {
    env: {
      staging: {
        d1_databases: [{ database_id: databaseId, database_name: 'publishing-platform-staging' }],
        r2_buckets: [{ bucket_name: 'publishing-artifacts-staging' }],
        vars: {
          ENABLED_ADAPTERS: 'web.pages',
          ADAPTER_CONFIGS: '{"openings":{"web.pages":{"baseUrl":"https://cloudflare-preview.openings-dev-web.pages.dev"}}}',
        },
      },
      production: { vars: { ENABLED_ADAPTERS: '' } },
    },
  };
}

describe('staging deploy readiness', () => {
  it('accepts isolated Pages-only staging', () => {
    expect(assertStagingReady(config())).toBe(true);
  });

  it('fails closed on placeholder resources', () => {
    expect(() => assertStagingReady(config('00000000-0000-0000-0000-000000000000'))).toThrow('placeholder');
    expect(() => assertStagingReady(config('00000000-0000-0000-0000-000000000002'))).toThrow('placeholder');
  });

  it('prevents OneSignal or production activation in the initial staging deploy', () => {
    const unsafe = config();
    unsafe.env.staging.vars.ENABLED_ADAPTERS = 'web.pages,push.onesignal';
    expect(() => assertStagingReady(unsafe)).toThrow('only');
    unsafe.env.staging.vars.ENABLED_ADAPTERS = 'web.pages';
    unsafe.env.production.vars.ENABLED_ADAPTERS = 'web.pages';
    expect(() => assertStagingReady(unsafe)).toThrow('Production');
  });
});
