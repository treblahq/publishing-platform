import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { resolve } from 'node:path';

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

  it('reports account-wide usage and active reservations against the free allowance', async () => {
    const rows = [{
      resource: 'd1Rows', used: 1000, reserved: 50, free_allowance: 100000,
      warning_limit: 42000, reject_limit: 49000,
    }];
    const db = database();
    db.statement.all.mockResolvedValueOnce({ results: rows });
    await expect(createD1AdminDependencies(db, 'token').capacity()).resolves.toEqual([{
      ...rows[0], projected: 1050, percentOfFree: 1.05, state: 'normal',
    }]);
    expect(String(db.prepare.mock.calls[0]?.[0])).toContain('capacity_limits');
  });

  it('executes the capacity report against the authoritative SQLite schema', async () => {
    const sqlite = new DatabaseSync(':memory:');
    for (const migration of ['0001_core.sql', '0002_capacity.sql', '0004_capacity_reservations.sql']) {
      sqlite.exec(readFileSync(resolve('apps/worker/migrations', migration), 'utf8'));
    }
    sqlite.exec(`
      INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1);
      INSERT INTO capacity_usage (tenant_id, resource, window_start, used, measured_at)
        VALUES ('openings', 'd1Rows', '2026-09-05T00:00:00.000Z', 1000, '2026-09-05T16:00:00.000Z');
      INSERT INTO capacity_reservations (id, tenant_id, resource, amount, state, expires_at)
        VALUES ('reservation-1', 'openings', 'd1Rows', 50, 'reserved', '2099-01-01T00:00:00.000Z');
    `);
    const d1 = {
      prepare(sql: string) {
        const statement = sqlite.prepare(sql);
        return sqliteStatement(statement);
      },
      batch: vi.fn(),
    };
    await expect(createD1AdminDependencies(d1, 'token').capacity()).resolves.toContainEqual(
      expect.objectContaining({ resource: 'd1Rows', used: 1000, reserved: 50, projected: 1050, percentOfFree: 1.05 }),
    );
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

function sqliteStatement(statement: StatementSync, bindings: SQLInputValue[] = []) {
  const wrapper = {
    bind(...values: unknown[]) { return sqliteStatement(statement, values as SQLInputValue[]); },
    first() { return Promise.resolve(statement.get(...bindings) ?? null); },
    all() { return Promise.resolve({ results: statement.all(...bindings) }); },
  };
  return wrapper;
}
