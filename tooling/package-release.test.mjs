import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

async function readPackage(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

describe('public package release metadata', () => {
  it('keeps the public packages on the same explicit release', async () => {
    const contracts = await readPackage('packages/contracts/package.json');
    const client = await readPackage('packages/client/package.json');

    expect(contracts.name).toBe('@trebla/publishing-contracts');
    expect(client.name).toBe('@trebla/publishing-client');
    expect(contracts.version).toBe('0.1.0');
    expect(client.version).toBe(contracts.version);
    expect(client.dependencies['@trebla/publishing-contracts']).toBe(
      contracts.version,
    );
  });

  it.each(['contracts', 'client'])(
    'publishes %s publicly without compiled tests',
    async (packageName) => {
      const packageJson = await readPackage(
        `packages/${packageName}/package.json`,
      );

      expect(packageJson.private).not.toBe(true);
      expect(packageJson.license).toBe('MIT');
      expect(packageJson.engines.node).toBe('>=20');
      expect(packageJson.publishConfig).toEqual({
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      });
      expect(packageJson.files).toContain('!dist/**/*.test.*');
      expect(packageJson.repository.url).toBe(
        'git+https://github.com/treblahq/publishing-platform.git',
      );
    },
  );
});
