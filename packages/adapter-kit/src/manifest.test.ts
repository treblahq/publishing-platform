import { describe, expect, it } from 'vitest';

import { assertAdapterSupports, validateAdapterManifest } from './manifest.js';

const manifest = {
  contractVersion: 1,
  name: 'push.onesignal',
  channels: ['push.notification'],
  operations: ['publish'],
  capabilities: {
    providerIdempotency: true,
    reconciliation: true,
    asynchronousIngestion: false,
  },
} as const;

describe('adapter manifests', () => {
  it('accepts declared compile-time capabilities', () => {
    expect(validateAdapterManifest(manifest)).toEqual(manifest);
  });

  it.each([
    ['unknown contract', { ...manifest, contractVersion: 2 }],
    ['empty channel list', { ...manifest, channels: [] }],
    ['duplicate operation', { ...manifest, operations: ['publish', 'publish'] }],
    ['unknown channel', { ...manifest, channels: ['email.message'] }],
  ])('rejects %s', (_label, value) => {
    expect(() => validateAdapterManifest(value)).toThrow();
  });

  it('accepts only operations and channels declared at build time', () => {
    expect(() => { assertAdapterSupports(manifest, 'push.notification', 'publish'); }).not.toThrow();
    expect(() => { assertAdapterSupports(manifest, 'social.post', 'publish'); }).toThrow(
      'Adapter push.onesignal does not support social.post',
    );
    expect(() => { assertAdapterSupports(manifest, 'push.notification', 'delete'); }).toThrow(
      'Adapter push.onesignal does not support operation delete',
    );
  });
});
