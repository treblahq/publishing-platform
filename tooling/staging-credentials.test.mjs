import { describe, expect, it } from 'vitest';

import { assertStagingCredentials } from './staging-credentials.mjs';

function credentials(overrides = {}) {
  return {
    CLOUDFLARE_API_TOKEN: 'cfut_valid-looking-token',
    CLOUDFLARE_ACCOUNT_ID: '850a1f06fde581b70886875da15ce6c1',
    CLOUDFLARE_D1_DATABASE_ID: '75c6770b-a94e-4b15-8b84-f6af7e7d2afe',
    PRODUCER_SIGNING_SECRET: 'producer-secret',
    ADMIN_TOKEN: 'admin-secret',
    ...overrides,
  };
}

describe('staging credential preflight', () => {
  it('accepts a user API token and valid staging identifiers', () => {
    expect(assertStagingCredentials(credentials())).toBe(true);
  });

  it('rejects account-owned tokens before expensive workflow steps', () => {
    expect(() => assertStagingCredentials(credentials({
      CLOUDFLARE_API_TOKEN: 'cfat_incompatible-token',
    }))).toThrow('user API token');
  });

  it.each([
    ['CLOUDFLARE_API_TOKEN', ''],
    ['CLOUDFLARE_ACCOUNT_ID', 'not-an-account-id'],
    ['CLOUDFLARE_D1_DATABASE_ID', '00000000-0000-0000-0000-000000000002'],
    ['PRODUCER_SIGNING_SECRET', ''],
    ['ADMIN_TOKEN', ''],
  ])('fails closed when %s is missing or malformed', (name, value) => {
    expect(() => assertStagingCredentials(credentials({ [name]: value }))).toThrow();
  });

  it('never includes a secret value in an error', () => {
    const secret = 'do-not-print-this-token';
    expect(() => assertStagingCredentials(credentials({ CLOUDFLARE_API_TOKEN: secret })))
      .toThrowError(expect.not.objectContaining({ message: expect.stringContaining(secret) }));
  });
});
