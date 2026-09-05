import { describe, expect, it } from 'vitest';

import * as d1Lease from './d1-lease.js';

class Statement {
  bindings: unknown[] = [];
  constructor(readonly sql: string, readonly row: unknown) {}
  bind(...values: unknown[]) { this.bindings = values; return this; }
  first<T>() { return Promise.resolve(this.row as T | null); }
}

describe('D1 delivery leases', () => {
  it('acquires with one conditional update and returns the fencing token', async () => {
    const acquireD1Lease = Reflect.get(d1Lease, 'acquireD1Lease');
    expect(acquireD1Lease).toBeTypeOf('function');
    let statement: Statement | undefined;
    const database = { prepare: (sql: string) => (statement = new Statement(sql, { lease_token: 4 })) };
    await expect(acquireD1Lease(database, 'tenant-1', 'delivery-1', new Date('2026-09-04T15:00:00.000Z'), 60_000)).resolves.toMatchObject({ acquired: true, token: 4 });
    expect(statement?.sql).toContain('lease_token = lease_token + 1');
    expect(statement?.sql).toContain('tenant_id = ?');
    expect(statement?.sql).toContain("state IN ('planned','validated','ready','delivering')");
  });

  it('reports contention when the conditional update returns no row', async () => {
    const acquireD1Lease = Reflect.get(d1Lease, 'acquireD1Lease');
    expect(acquireD1Lease).toBeTypeOf('function');
    const database = { prepare: (sql: string) => new Statement(sql, null) };
    await expect(acquireD1Lease(database, 'tenant-1', 'delivery-1', new Date(), 60_000)).resolves.toEqual({ acquired: false });
  });

  it('leases reconciliation only while the durable state is still ambiguous', async () => {
    let statement: Statement | undefined;
    const database = { prepare: (sql: string) => (statement = new Statement(sql, { lease_token: 5 })) };
    await d1Lease.acquireD1Lease(database, 'tenant-1', 'delivery-1', new Date(), 60_000, 'reconciliation');
    expect(statement?.sql).toContain("state = 'reconciling'");
  });
});
