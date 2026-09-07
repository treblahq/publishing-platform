import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createD1DeliveryStore } from './d1-delivery-store.js';

describe('delivery commit fencing against the authoritative schema', () => {
  it.each([6, 7])('only the current lease can release artifact bytes: token %s', async (token) => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync('apps/worker/migrations/0001_core.sql', 'utf8'));
    sqlite.exec(`
      INSERT INTO tenants (id, name, enabled) VALUES ('troco', 'Troco', 1);
      INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('client', 'troco', 'publisher', 1, 'hash');
      INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
        VALUES ('publication', 'troco', 'client', 'campaign', 'campaign', '1', 'key', '{}', 'accepted');
      INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state, lease_token)
        VALUES ('delivery', 'troco', 'publication', 'social', 'social.shadow', 'compare', 0, '{}', 'delivering', 7);
      INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
        VALUES ('artifact', 'troco', 'r2-temporary', 'hash', 1, 'image/png', 'temporary/troco/file', 'available');
      INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id) VALUES ('troco', 'artifact', 'delivery');
    `);
    const executions = new WeakMap<object, () => { meta: { changes: number } }>();
    const database = {
      prepare(sql: string) {
        let bindings: SQLInputValue[] = [];
        const statement = {
          bind(...values: unknown[]) { bindings = values as SQLInputValue[]; return this; },
          first: () => Promise.resolve(sqlite.prepare(sql).get(...bindings) ?? null),
          all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...bindings) }),
        };
        executions.set(statement, () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }));
        return statement;
      },
      batch(statements: object[]) {
        sqlite.exec('BEGIN');
        try {
          const results = statements.map((statement) => {
            const execute = executions.get(statement);
            if (!execute) throw new Error('Unregistered test statement');
            return execute();
          });
          sqlite.exec('COMMIT');
          return Promise.resolve(results);
        } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    try {
      const result = createD1DeliveryStore(database, () => ({})).commit('troco', 'delivery', token, 'verified', {
        provider: 'shadow', remoteId: 'remote', acceptedAt: '2026-09-07T12:00:00.000Z',
      }, undefined, ['artifact']);
      if (token === 6) await expect(result).rejects.toThrow('stale');
      else await result;
      expect(sqlite.prepare('SELECT safe_to_delete FROM artifact_references').get()).toMatchObject({ safe_to_delete: token === 7 ? 1 : 0 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM receipts').get()).toMatchObject({ count: token === 7 ? 1 : 0 });
      expect(sqlite.prepare('SELECT state FROM deliveries').get()).toMatchObject({ state: token === 7 ? 'verified' : 'delivering' });
    } finally { sqlite.close(); }
  });
});
