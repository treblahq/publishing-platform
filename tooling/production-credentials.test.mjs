import { describe, expect, it } from 'vitest';
import { assertProductionCredentials } from './production-credentials.mjs';

const safe = {
  CLOUDFLARE_API_TOKEN: 'cfut_production-candidate-token',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_D1_DATABASE_ID: '75c6770b-a94e-4b15-8b84-f6af7e7d2afe',
  ADMIN_TOKEN: 'private-admin-token',
};

describe('production candidate credentials', () => {
  it('accepts deployment and read-only administration without a producer secret', () => {
    expect(assertProductionCredentials(safe)).toBe(true);
  });

  it.each(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'ADMIN_TOKEN'])(
    'rejects missing %s', (name) => {
      const invalid = { ...safe };
      delete invalid[name];
      expect(() => assertProductionCredentials(invalid)).toThrow(name);
    },
  );
});
