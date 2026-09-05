import { describe, expect, it } from 'vitest';
import { assertStagingReady } from './staging-readiness.mjs';

function config(databaseId = '11111111-2222-4333-8444-555555555555') {
  return {
    env: {
      staging: {
        d1_databases: [{ database_id: databaseId, database_name: 'publishing-platform-staging' }],
        r2_buckets: [{ bucket_name: 'publishing-artifacts-staging' }],
        vars: {
          ENABLED_ADAPTERS: 'web.r2',
          ADAPTER_CONFIGS: JSON.stringify({
            openings: {
              'web.r2': {
                publicBaseUrl: 'https://cloudflare-preview.openings-dev-web.pages.dev',
                shellBaseUrl: 'https://cloudflare-preview.openings-dev-web.pages.dev',
                canonicalBaseUrl: 'https://openings.dev',
              },
            },
          }),
        },
      },
      production: { vars: { ENABLED_ADAPTERS: '' } },
    },
  };
}

describe('staging deploy readiness', () => {
  it('accepts isolated R2 staging while mobile push is deferred', () => {
    expect(assertStagingReady(config())).toBe(true);
  });

  it('fails closed on placeholder resources', () => {
    expect(() => assertStagingReady(config('00000000-0000-0000-0000-000000000000'))).toThrow('placeholder');
    expect(() => assertStagingReady(config('00000000-0000-0000-0000-000000000002'))).toThrow('placeholder');
  });

  it('prevents unknown adapters or production activation in staging', () => {
    const unsafe = config();
    unsafe.env.staging.vars.ENABLED_ADAPTERS = 'web.r2,social.unknown';
    expect(() => assertStagingReady(unsafe)).toThrow('only');
    unsafe.env.staging.vars.ENABLED_ADAPTERS = 'web.r2';
    unsafe.env.production.vars.ENABLED_ADAPTERS = 'web.pages';
    expect(() => assertStagingReady(unsafe)).toThrow('Production');
  });

  it('rejects any OneSignal configuration while mobile push is deferred', () => {
    const unsafe = config();
    const adapters = JSON.parse(unsafe.env.staging.vars.ADAPTER_CONFIGS);
    adapters.openings['push.onesignal'] = { audienceMode: 'staging-segment' };
    unsafe.env.staging.vars.ADAPTER_CONFIGS = JSON.stringify(adapters);
    expect(() => assertStagingReady(unsafe)).toThrow('absent');
  });
});
