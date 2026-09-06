import { describe, expect, it } from 'vitest';
import { assertProductionReady } from './production-readiness.mjs';

const preview = 'https://cloudflare-preview.openings-dev-web.pages.dev';

function config() {
  return {
    env: {
      production: {
        name: 'publishing-platform-production',
        d1_databases: [{
          binding: 'LEDGER', database_name: 'publishing-platform-staging',
          database_id: '75c6770b-a94e-4b15-8b84-f6af7e7d2afe',
        }],
        r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: 'publishing-artifacts-staging' }],
        queues: {
          producers: [
            { binding: 'DELIVERY_QUEUE', queue: 'publishing-delivery-production' },
            { binding: 'DELIVERY_DLQ', queue: 'publishing-delivery-dlq-production' },
          ],
          consumers: [
            { queue: 'publishing-delivery-production', dead_letter_queue: 'publishing-delivery-dlq-production' },
            { queue: 'publishing-delivery-dlq-production' },
          ],
        },
        vars: {
          ENABLED_ADAPTERS: 'web.r2',
          ADAPTER_CONFIGS: JSON.stringify({ openings: { 'web.r2': {
            publicBaseUrl: preview, shellBaseUrl: preview, canonicalBaseUrl: 'https://openings.dev',
          } } }),
        },
      },
    },
  };
}

describe('production readiness', () => {
  it('accepts promoted data with isolated production messaging', () => {
    expect(assertProductionReady(config())).toBe(true);
  });

  it.each([
    ['placeholder D1', (value) => { value.env.production.d1_databases[0].database_id = '00000000-0000-0000-0000-000000000003'; }],
    ['different D1', (value) => { value.env.production.d1_databases[0].database_name = 'publishing-platform-production'; }],
    ['different R2', (value) => { value.env.production.r2_buckets[0].bucket_name = 'publishing-artifacts-production'; }],
    ['extra adapter', (value) => { value.env.production.vars.ENABLED_ADAPTERS = 'web.r2,social.linkedin'; }],
    ['OneSignal config', (value) => { const adapters = JSON.parse(value.env.production.vars.ADAPTER_CONFIGS); adapters.openings['push.onesignal'] = {}; value.env.production.vars.ADAPTER_CONFIGS = JSON.stringify(adapters); }],
    ['wrong Pages origin', (value) => { const adapters = JSON.parse(value.env.production.vars.ADAPTER_CONFIGS); adapters.openings['web.r2'].publicBaseUrl = 'https://openings.dev'; value.env.production.vars.ADAPTER_CONFIGS = JSON.stringify(adapters); }],
    ['shared queue', (value) => { value.env.production.queues.producers[0].queue = 'publishing-delivery-staging'; }],
    ['staging environment', (value) => { value.env.staging = { triggers: { crons: [] } }; }],
  ])('rejects %s', (_name, mutate) => {
    const unsafe = config();
    mutate(unsafe);
    expect(() => assertProductionReady(unsafe)).toThrow();
  });
});
