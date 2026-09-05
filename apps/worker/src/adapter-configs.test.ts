import { describe, expect, it } from 'vitest';

import { parseAdapterConfigs } from './adapter-configs.js';

const config = JSON.stringify({
  openings: {
    'web.pages': { baseUrl: 'https://preview.invalid' },
    'push.onesignal': {
      appId: 'app-id',
      audienceMode: 'staging-segment',
      testSegment: 'Publishing Platform Canary',
      attestation: { observedMobileMau: 1 },
    },
  },
});

describe('runtime adapter configuration', () => {
  it('injects the OneSignal key from a Worker secret', () => {
    expect(parseAdapterConfigs(config, 'secret-value').openings?.['push.onesignal']?.restApiKey)
      .toBe('secret-value');
  });

  it('rejects a OneSignal key embedded in public configuration', () => {
    const unsafe = config.replace('"appId":"app-id"', '"appId":"app-id","restApiKey":"public-secret"');
    expect(() => parseAdapterConfigs(unsafe, 'secret-value')).toThrow('public configuration');
  });

  it('fails closed when OneSignal is configured without its Worker secret', () => {
    expect(() => parseAdapterConfigs(config, undefined)).toThrow('Worker secret');
  });

  it('allows Pages-only configuration without a OneSignal secret', () => {
    expect(parseAdapterConfigs(
      '{"openings":{"web.pages":{"baseUrl":"https://preview.invalid"}}}',
      undefined,
    ).openings?.['web.pages']?.baseUrl).toBe('https://preview.invalid');
  });
});
