import { describe, expect, it, vi } from 'vitest';

import { createD1AdminDependencies } from './d1-admin.js';

function database(results: unknown[] = []) {
  const first = vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? null));
  const all = vi.fn().mockResolvedValue({ results: [] });
  const statement = { bind: vi.fn(), first, all };
  statement.bind.mockReturnValue(statement);
  return { prepare: vi.fn().mockReturnValue(statement), batch: vi.fn().mockResolvedValue([]), statement };
}

describe('D1 admin operations', () => {
  it('fails readiness when durable work or free-tier accounting needs attention', async () => {
    const db = database([{ stale_outbox: 0, expired_leases: 0, needs_attention: 1, paused_adapters: 0, open_incidents: 1, stale_capacity: 0 }]);
    await expect(createD1AdminDependencies(db, 'token').ready()).resolves.toMatchObject({ ready: false });
  });

  it('reports ready only when every durable safety check is clear', async () => {
    const checks = { stale_outbox: 0, expired_leases: 0, needs_attention: 0, paused_adapters: 0, open_incidents: 0, stale_capacity: 0 };
    const db = database([checks]);
    await expect(createD1AdminDependencies(db, 'token').ready()).resolves.toEqual({ ready: true, checks });
  });

  it('keeps inspection tenant scoped', async () => {
    const db = database([{ id: 'publication-1' }]);
    const admin = createD1AdminDependencies(db, 'token');
    await admin.inspect('openings', 'publication-1');
    expect(db.statement.bind).toHaveBeenCalledWith('openings', 'publication-1');
  });

  it('replays the same delivery through an idempotent outbox upsert and audit batch', async () => {
    const db = database();
    const admin = createD1AdminDependencies(db, 'token', () => 'audit-id');
    await admin.replay('openings', 'delivery-1', 'verified absence');
    expect(db.batch).toHaveBeenCalledOnce();
    expect(db.prepare.mock.calls.map((call) => String(call[0])).join('\n')).toContain('ON CONFLICT');
  });

  it('pauses and resumes a tenant adapter through audited upserts', async () => {
    const db = database();
    const admin = createD1AdminDependencies(db, 'token');
    await admin.setAdapter('openings', 'push.onesignal', false, 'MAU stale');
    await admin.setAdapter('openings', 'push.onesignal', true, 'MAU verified');
    expect(db.batch).toHaveBeenCalledTimes(2);
  });
});
