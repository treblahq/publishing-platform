import { describe, expect, it } from 'vitest';

import { createFakeAdapter } from '@trebla/publishing-adapter-test';

import * as registryModule from './registry.js';

describe('compile-time adapter registry', () => {
  it('resolves only adapters enabled for the environment', () => {
    const createAdapterRegistry = Reflect.get(registryModule, 'createAdapterRegistry');
    expect(createAdapterRegistry).toBeTypeOf('function');
    const adapter = createFakeAdapter();
    const disabled = createAdapterRegistry([adapter], []);
    const enabled = createAdapterRegistry([adapter], ['test.fake']);
    expect(disabled.resolve('test.fake')).toEqual({ outcome: 'disabled' });
    expect(enabled.resolve('test.fake')).toMatchObject({ outcome: 'available', adapter });
  });

  it('rejects adapters absent from the compiled registry', () => {
    const createAdapterRegistry = Reflect.get(registryModule, 'createAdapterRegistry');
    expect(createAdapterRegistry).toBeTypeOf('function');
    expect(createAdapterRegistry([], []).resolve('social.unknown')).toEqual({ outcome: 'unknown' });
  });
});
