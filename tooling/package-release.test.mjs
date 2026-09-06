import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

async function readPackage(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), 'utf8'));
}

describe('public package release metadata', () => {
  it('exposes one public package with the unified name', async () => {
    const publishing = await readPackage('packages/publishing/package.json');

    expect(publishing.name).toBe('@trebla/publishing');
    expect(publishing.version).toBe('0.1.0');
    expect(publishing.private).not.toBe(true);
  });

  it('publishes the unified package publicly without compiled tests', async () => {
      const packageJson = await readPackage('packages/publishing/package.json');

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
  });

  it('keeps every other workspace private', async () => {
    const manifests = [];
    for (const parent of ['apps', 'packages']) {
      for (const directory of await readdir(resolve(root, parent))) {
        const relativePath = `${parent}/${directory}/package.json`;
        const packageJson = await readPackage(relativePath);
        if (packageJson.name !== '@trebla/publishing') manifests.push(packageJson);
      }
    }

    expect(manifests.length).toBeGreaterThan(0);
    expect(manifests.every(({ private: isPrivate }) => isPrivate === true)).toBe(true);
  });
});
