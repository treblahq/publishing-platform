import { describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@trebla/publishing';

import { createD1ProducerClientLoader } from './d1-client-loader.js';

describe('D1 producer client loader', () => {
  it('combines tenant-scoped metadata with a verified secret binding', async () => {
    const secretHash = await sha256Hex('runtime-secret');
    const first = vi.fn().mockResolvedValue({
      id: 'client-1', tenant_id: 'openings', client_enabled: 1, tenant_enabled: 1, secret_hash: secretHash,
    });
    const database = { prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ first }) }) };
    const load = createD1ProducerClientLoader(database, (id) => id === 'client-1' ? 'runtime-secret' : undefined);
    await expect(load('client-1')).resolves.toEqual({
      id: 'client-1', tenant: 'openings', enabled: true, secret: 'runtime-secret',
    });
    expect(database.prepare.mock.calls[0]?.[0]).toContain('tenants');
  });

  it('fails closed if the binding is missing or does not match the stored hash', async () => {
    const row = {
      id: 'client-1', tenant_id: 'openings', client_enabled: 1, tenant_enabled: 1,
      secret_hash: await sha256Hex('correct-secret'),
    };
    const statement = {
      bind: () => statement,
      first: () => Promise.resolve(row),
    };
    const database = { prepare: () => statement };
    await expect(createD1ProducerClientLoader(database, () => undefined)('client-1')).resolves.toBeNull();
    await expect(createD1ProducerClientLoader(database, () => 'wrong-secret')('client-1')).resolves.toBeNull();
  });
});
