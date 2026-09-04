import { describe, expect, it } from 'vitest';

import * as secretScan from './secret-scan.mjs';

describe('repository secret scan', () => {
  it('rejects a seeded fake provider token', () => {
    const scanText = Reflect.get(secretScan, 'scanText');
    expect(scanText).toBeTypeOf('function');
    const fakeToken = ['ghp', 'A'.repeat(36)].join('_');
    expect(scanText('fixture.txt', `TOKEN=${fakeToken}`)).toContain('fixture.txt:1');
  });

  it('allows ordinary secret-related source and test language', () => {
    const scanText = Reflect.get(secretScan, 'scanText');
    expect(scanText).toBeTypeOf('function');
    expect(scanText('example.ts', "const secret = 'test-secret';")).toEqual([]);
  });
});
