import { describe, expect, it } from 'vitest';

import * as d1State from './d1-state.js';

class Statement {
  bindings: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]) { this.bindings = values; return this; }
}

describe('fenced D1 state commit', () => {
  it('guards the state update with tenant, delivery, and current fencing token', async () => {
    const commitD1DeliveryState = Reflect.get(d1State, 'commitD1DeliveryState');
    expect(commitD1DeliveryState).toBeTypeOf('function');
    const statements: Statement[] = [];
    const database = {
      prepare: (sql: string) => { const statement = new Statement(sql); statements.push(statement); return statement; },
      batch: () => Promise.resolve([{ meta: { changes: 1 } }]),
    };
    await commitD1DeliveryState(database, 'tenant-1', 'delivery-1', 7, 'verified');
    expect(statements[0]?.sql).toMatch(/tenant_id = \?.*id = \?.*lease_token = \?/su);
    expect(statements[0]?.bindings).toContain(7);
  });

  it('rejects a stale fencing token when no row changes', async () => {
    const commitD1DeliveryState = Reflect.get(d1State, 'commitD1DeliveryState');
    expect(commitD1DeliveryState).toBeTypeOf('function');
    const database = { prepare: (sql: string) => new Statement(sql), batch: () => Promise.resolve([{ meta: { changes: 0 } }]) };
    await expect(commitD1DeliveryState(database, 'tenant-1', 'delivery-1', 6, 'verified')).rejects.toThrow('stale');
  });
});
