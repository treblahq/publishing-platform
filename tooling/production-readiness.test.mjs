import { describe, expect, it } from 'vitest';
import { assertProductionReady } from './production-readiness.mjs';

const preview = 'https://openings-dev-web-dfy.pages.dev';

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
  it('accepts the provider-free social shadow rollout beside web delivery', () => {
    const value = config();
    value.env.production.vars.ENABLED_ADAPTERS = 'web.r2,social.shadow';
    expect(assertProductionReady(value)).toBe(true);
  });

  function mastodonConfig() {
    const value = config();
    value.env.production.vars.ENABLED_ADAPTERS = 'web.r2,social.shadow,social.mastodon';
    const adapters = JSON.parse(value.env.production.vars.ADAPTER_CONFIGS);
    adapters.openings['social.mastodon'] = { baseUrl: 'https://mastodon.social' };
    value.env.production.vars.ADAPTER_CONFIGS = JSON.stringify(adapters);
    return value;
  }

  it('accepts only the approved Openings Mastodon rollout configuration', () => {
    expect(assertProductionReady(mastodonConfig())).toBe(true);
  });

  it.each([
    ['unapproved host', (adapters) => { adapters.openings['social.mastodon'].baseUrl = 'https://other.example'; }],
    ['public credential', (adapters) => { adapters.openings['social.mastodon'].accessToken = 'test-only-not-a-secret'; }],
    ['unknown option', (adapters) => { adapters.openings['social.mastodon'].account = 'another'; }],
    ['missing configuration', (adapters) => { delete adapters.openings['social.mastodon']; }],
    ['null configuration', (adapters) => { adapters.openings['social.mastodon'] = null; }],
    ['another tenant', (adapters) => { adapters.troco = { 'social.mastodon': { baseUrl: 'https://mastodon.social' } }; }],
    ['another provider', (adapters) => { adapters.openings['social.linkedin'] = {}; }],
  ])('rejects Mastodon rollout with %s', (_name, mutate) => {
    const value = mastodonConfig();
    const adapters = JSON.parse(value.env.production.vars.ADAPTER_CONFIGS);
    mutate(adapters);
    value.env.production.vars.ADAPTER_CONFIGS = JSON.stringify(adapters);
    expect(() => assertProductionReady(value)).toThrow();
  });

  it('rejects Mastodon configuration without explicit adapter enablement', () => {
    const value = mastodonConfig();
    value.env.production.vars.ENABLED_ADAPTERS = 'web.r2,social.shadow';
    expect(() => assertProductionReady(value)).toThrow();
  });

  it.each(['root', 'production'])('rejects Mastodon credentials in public %s vars', (scope) => {
    const value = mastodonConfig();
    const target = scope === 'root' ? value : value.env.production;
    target.vars = { ...target.vars, MASTODON_ACCESS_TOKENS: '{"openings":"test-only-token"}' };
    expect(() => assertProductionReady(value)).toThrow();
  });

  it.each(['root', 'production'])('rejects Buffer credentials in public %s vars even while disabled', (scope) => {
    const value = mastodonConfig();
    const target = scope === 'root' ? value : value.env.production;
    target.vars = { ...target.vars, BUFFER_API_KEYS: '{"trebla":"test-only-token"}' };
    expect(() => assertProductionReady(value)).toThrow(/credentials must be installed as Worker secrets/u);
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
