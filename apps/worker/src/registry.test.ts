import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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

  it('compiles the provider-free social shadow adapter into both runtime paths', () => {
    const source = readFileSync('apps/worker/src/index.ts', 'utf8');
    const packageManifest = JSON.parse(readFileSync('apps/worker/package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageManifest.dependencies).toHaveProperty('@trebla/publishing-adapter-shadow', '0.1.0');
    expect(source).toContain("import { createSocialShadowAdapter } from '@trebla/publishing-adapter-shadow'");
    expect(source.match(/createSocialShadowAdapter\(\)/gu)).toHaveLength(2);
  });
  it('compiles Mastodon without enabling its public effects in production', () => {
    const source = readFileSync('apps/worker/src/index.ts', 'utf8');
    expect(source.match(/createMastodonAdapter\(\)/gu)).toHaveLength(2);
    const config = JSON.parse(readFileSync('apps/worker/wrangler.json', 'utf8')) as {
      env: { production: { vars: { ENABLED_ADAPTERS: string } } };
    };
    expect(config.env.production.vars.ENABLED_ADAPTERS.split(',')).not.toContain('social.mastodon');
  });
});
