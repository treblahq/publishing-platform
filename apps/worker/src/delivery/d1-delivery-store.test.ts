import { describe, expect, it, vi } from 'vitest';

import { createD1DeliveryStore } from './d1-delivery-store.js';

describe('D1 delivery store', () => {
  it('loads work and artifacts with tenant scope', async () => {
    const first = vi.fn().mockResolvedValue({
      id: 'delivery-1', tenant_id: 'openings', adapter: 'push.onesignal', operation: 'publish', state: 'ready',
      delivery_key: 'push', idempotency_key: 'publication-key', payload_json: '{"type":"push.notification"}',
    });
    const all = vi.fn().mockResolvedValue({ results: [{
      id: 'artifact-1', storage: 'external', sha256: 'a'.repeat(64), byte_size: 10,
      media_type: 'image/png', locator: 'https://example.test/image.png',
    }] });
    const statements = [statement({ first }), statement({ all })];
    const database = { prepare: vi.fn().mockImplementation(() => statements.shift()), batch: vi.fn() };
    const store = createD1DeliveryStore(database, (adapter) => ({ adapter }));
    await expect(store.load('openings', 'delivery-1')).resolves.toMatchObject({
      tenant: 'openings', id: 'delivery-1', idempotencyKey: 'publication-key:push',
      config: { adapter: 'push.onesignal' }, artifacts: [{ id: 'artifact-1', byteSize: 10 }], state: 'ready',
    });
    expect(first.mock.calls[0]).toEqual([]);
    expect(database.prepare.mock.calls[0]?.[0]).toContain('delivery.tenant_id = ?');
  });

  it('commits a fenced state and receipt in one D1 batch', async () => {
    const batch = vi.fn().mockResolvedValue([{ meta: { changes: 1 } }, { meta: { changes: 1 } }, { meta: { changes: 1 } }]);
    const database = { prepare: vi.fn().mockImplementation(() => statement({})), batch };
    const store = createD1DeliveryStore(database, () => ({}), () => 'receipt-id');
    await store.commit('openings', 'delivery-1', 7, 'verified', {
      provider: 'push.onesignal', remoteId: 'remote-1', acceptedAt: '2026-09-04T12:00:00.000Z',
    }, undefined, ['artifact-1']);
    expect(batch).toHaveBeenCalledOnce();
    expect(database.prepare).toHaveBeenCalledTimes(3);
    expect(database.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain('safe_to_delete = 1');
  });

  it('rejects a stale fenced commit', async () => {
    const database = {
      prepare: () => statement({}),
      batch: () => Promise.resolve([{ meta: { changes: 0 } }]),
    };
    const store = createD1DeliveryStore(database, () => ({}));
    await expect(store.commit('openings', 'delivery-1', 6, 'verified')).rejects.toThrow('stale');
  });

  it('binds the provider retry time while retaining a safe fallback', async () => {
    const bound: unknown[][] = [];
    const database = {
      prepare: vi.fn().mockImplementation(() => {
        const value = statement({});
        value.bind.mockImplementation((...values: unknown[]) => { bound.push(values); return value; });
        return value;
      }),
      batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }]),
    };
    const store = createD1DeliveryStore(database, () => ({}));
    await store.commit('openings', 'delivery-1', 7, 'retry_wait', undefined, '2026-09-04T15:07:00.000Z');
    expect(bound[0]).toEqual(['retry_wait', 'retry_wait', '2026-09-04T15:07:00.000Z', 'openings', 'delivery-1', 7]);
    expect(database.prepare.mock.calls[0]?.[0]).toContain('COALESCE(?,');
  });
});

function statement(methods: Record<string, unknown>) {
  const value = { bind: vi.fn(), first: vi.fn(), all: vi.fn(), ...methods };
  value.bind.mockReturnValue(value);
  return value;
}
