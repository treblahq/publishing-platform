import { describe, expect, it } from 'vitest';
import { assertStagingReady } from './staging-readiness.mjs';

const oneSignal = {
  appId: '1215bd53-ffd9-4f11-b3c2-bb2999a1e500',
  audienceMode: 'staging-segment',
  testSegment: 'Publishing Platform Canary',
  attestation: {
    observedMobileMau: 1,
    providerCeiling: 1_000,
    internalPause: 700,
    observedAt: '2026-09-05T17:00:00.000Z',
    expiresAt: '2026-09-12T17:00:00.000Z',
    evidenceHash: '47fd49db2729d0740d28ffa4c7520c72efdcff930402e7f99a28caad07a85e07',
  },
};
const now = new Date('2026-09-05T18:00:00.000Z');

function config(databaseId = '11111111-2222-4333-8444-555555555555') {
  return {
    env: {
      staging: {
        d1_databases: [{ database_id: databaseId, database_name: 'publishing-platform-staging' }],
        r2_buckets: [{ bucket_name: 'publishing-artifacts-staging' }],
        vars: {
          ENABLED_ADAPTERS: 'web.r2,push.onesignal',
          ADAPTER_CONFIGS: JSON.stringify({
            openings: {
              'web.r2': {
                publicBaseUrl: 'https://cloudflare-preview.openings-dev-web.pages.dev',
                shellBaseUrl: 'https://cloudflare-preview.openings-dev-web.pages.dev',
                canonicalBaseUrl: 'https://openings.dev',
              },
              'push.onesignal': oneSignal,
            },
          }),
        },
      },
      production: { vars: { ENABLED_ADAPTERS: '' } },
    },
  };
}

describe('staging deploy readiness', () => {
  it('accepts isolated staging with OneSignal restricted to its canary segment', () => {
    expect(assertStagingReady(config(), now)).toBe(true);
  });

  it('fails closed on placeholder resources', () => {
    expect(() => assertStagingReady(config('00000000-0000-0000-0000-000000000000'), now)).toThrow('placeholder');
    expect(() => assertStagingReady(config('00000000-0000-0000-0000-000000000002'), now)).toThrow('placeholder');
  });

  it('prevents unknown adapters or production activation in staging', () => {
    const unsafe = config();
    unsafe.env.staging.vars.ENABLED_ADAPTERS = 'web.r2,push.onesignal,social.unknown';
    expect(() => assertStagingReady(unsafe, now)).toThrow('only');
    unsafe.env.staging.vars.ENABLED_ADAPTERS = 'web.r2,push.onesignal';
    unsafe.env.production.vars.ENABLED_ADAPTERS = 'web.pages';
    expect(() => assertStagingReady(unsafe, now)).toThrow('Production');
  });

  it('rejects a broadcast audience or the wrong canary segment', () => {
    const unsafeAudience = config();
    const audienceAdapters = JSON.parse(unsafeAudience.env.staging.vars.ADAPTER_CONFIGS);
    audienceAdapters.openings['push.onesignal'].audienceMode = 'production-broadcast';
    unsafeAudience.env.staging.vars.ADAPTER_CONFIGS = JSON.stringify(audienceAdapters);
    expect(() => assertStagingReady(unsafeAudience, now)).toThrow('staging-segment');

    const unsafeSegment = config();
    const segmentAdapters = JSON.parse(unsafeSegment.env.staging.vars.ADAPTER_CONFIGS);
    segmentAdapters.openings['push.onesignal'].testSegment = 'Subscribed Users';
    unsafeSegment.env.staging.vars.ADAPTER_CONFIGS = JSON.stringify(segmentAdapters);
    expect(() => assertStagingReady(unsafeSegment, now)).toThrow('canary segment');
  });

  it('rejects a public API key or an invalid free-tier attestation', () => {
    const publicSecret = config();
    const secretAdapters = JSON.parse(publicSecret.env.staging.vars.ADAPTER_CONFIGS);
    secretAdapters.openings['push.onesignal'].restApiKey = 'must-not-be-public';
    publicSecret.env.staging.vars.ADAPTER_CONFIGS = JSON.stringify(secretAdapters);
    expect(() => assertStagingReady(publicSecret, now)).toThrow('secret');

    const overBudget = config();
    const budgetAdapters = JSON.parse(overBudget.env.staging.vars.ADAPTER_CONFIGS);
    budgetAdapters.openings['push.onesignal'].attestation.observedMobileMau = 700;
    overBudget.env.staging.vars.ADAPTER_CONFIGS = JSON.stringify(budgetAdapters);
    expect(() => assertStagingReady(overBudget, now)).toThrow('free-tier');
  });
});
