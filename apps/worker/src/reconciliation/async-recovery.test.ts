import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { createFakeAdapter } from '@trebla/publishing-adapter-test';
import { createD1DeliveryStore } from '../delivery/d1-delivery-store.js';
import { acquireD1Lease } from '../delivery/d1-lease.js';
import { consumeDelivery } from '../delivery/consume.js';
import { createAdapterRegistry } from '../registry.js';
import { reconcileDelivery } from './reconcile-delivery.js';
import { runD1Reconciliation } from './d1-reconciliation.js';
import { reconcileRuntimeDeliveries } from '../index.js';

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing fixture value');
  return value;
}

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('apps/worker/migrations/0001_core.sql', 'utf8'));
  const artifact = { id: 'logical', storage: 'r2-temporary', sha256: 'a'.repeat(64), byteSize: 10, mediaType: 'video/mp4', locator: 'temporary/troco/video' };
  const payload = { type: 'social.post', text: 'Approved', artifactIds: ['logical'] };
  const envelope = { schemaVersion: 1, identity: { tenant: 'troco', sourceType: 'campaign', sourceId: 'campaign', revision: '1', idempotencyKey: 'key' }, canonical: { title: 'Approved', language: 'pt-BR' }, artifacts: [artifact], deliveries: [{ id: 'social', adapter: 'test.fake', operation: 'publish', required: false, payload }] };
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('troco', 'Troco', 1), ('other', 'Other', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('client', 'troco', 'publisher', 1, 'hash');`);
  sqlite.prepare(`INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state) VALUES ('publication', 'troco', 'client', 'campaign', 'campaign', '1', 'key', ?, 'accepted')`).run(JSON.stringify(envelope));
  sqlite.prepare(`INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state) VALUES ('delivery', 'troco', 'publication', 'social', 'test.fake', 'publish', 0, ?, 'ready')`).run(JSON.stringify(payload));
  sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state) VALUES ('stored', 'troco', 'r2-temporary', ?, 10, 'video/mp4', ?, 'available')`).run(artifact.sha256, artifact.locator);
  sqlite.exec("INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id) VALUES ('troco', 'stored', 'delivery')");
  const executions = new WeakMap<object, () => { meta: { changes: number } }>();
  const database = {
    prepare(sql: string) {
      let bindings: SQLInputValue[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values as SQLInputValue[]; return this; },
        first: <T>() => Promise.resolve((sqlite.prepare(sql).get(...bindings) ?? null) as T | null),
        all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...bindings) }),
      };
      executions.set(statement, () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }));
      return statement;
    },
    batch(statements: object[]) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => required(executions.get(statement))());
        sqlite.exec('COMMIT');
        return Promise.resolve(results);
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const store = () => createD1DeliveryStore(database, () => ({}));
  const adapter = createFakeAdapter({ asynchronousIngestion: true });
  const dependencies = {
    registry: createAdapterRegistry([adapter], ['test.fake']), states: store(),
    leases: { acquire: acquireD1Lease.bind(null, database), commit: () => undefined },
    now: () => new Date('2026-09-07T12:00:00.000Z'),
  };
  return { sqlite, database, store, adapter, dependencies };
}

describe('durable asynchronous delivery recovery', () => {
  it.each(['quarantine', 'stale', 'lease-error'] as const)('runtime isolates poisoned receipt across tenants: %s', async (variant) => {
    const f = fixture();
    try {
      await consumeDelivery(required(await f.store().load('troco', 'delivery')), f.dependencies);
      f.sqlite.exec(`UPDATE receipts SET receipt_json = '{}';
        UPDATE deliveries SET updated_at = '2000-01-01';
        INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('other-client', 'other', 'publisher', 1, 'hash');`);
      const payload = { type: 'social.post', text: 'Healthy', artifactIds: [] };
      const envelope = { schemaVersion: 1, identity: { tenant: 'other', sourceType: 'campaign', sourceId: 'other', revision: '1', idempotencyKey: 'other-key' }, canonical: { title: 'Healthy', language: 'pt-BR' }, artifacts: [], deliveries: [{ id: 'social', adapter: 'social.shadow', operation: 'compare', required: false, payload }] };
      f.sqlite.prepare(`INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state) VALUES ('other-publication', 'other', 'other-client', 'campaign', 'other', '1', 'other-key', ?, 'accepted')`).run(JSON.stringify(envelope));
      f.sqlite.prepare(`INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state) VALUES ('healthy', 'other', 'other-publication', 'social', 'social.shadow', 'compare', 0, ?, 'processing')`).run(JSON.stringify(payload));
      const receipt = { provider: 'social.shadow', remoteId: `shadow:${'a'.repeat(64)}`, acceptedAt: '2026-09-07T12:00:00.000Z' };
      f.sqlite.prepare(`INSERT INTO receipts (id, tenant_id, delivery_id, provider, remote_id, receipt_json) VALUES ('healthy-receipt', 'other', 'healthy', ?, ?, ?)`).run(receipt.provider, receipt.remoteId, JSON.stringify(receipt));
      if (variant === 'stale') {
        const batch = f.database.batch.bind(f.database);
        vi.spyOn(f.database, 'batch').mockImplementationOnce((statements) => {
          f.sqlite.exec("UPDATE deliveries SET lease_token = lease_token + 1 WHERE id = 'delivery'");
          return batch(statements);
        });
      }
      if (variant === 'lease-error') {
        const prepare = f.database.prepare.bind(f.database);
        vi.spyOn(f.database, 'prepare').mockImplementation((sql) => {
          if (sql.includes('RETURNING lease_token')) {
            const statement = prepare(sql);
            const bind = statement.bind.bind(statement);
            statement.bind = (...values) => {
              if (values.includes('delivery')) throw new Error('Lease unavailable');
              return bind(...values);
            };
            return statement;
          }
          return prepare(sql);
        });
      }
      await expect(reconcileRuntimeDeliveries({ ADAPTER_CONFIGS: '{}' }, f.database as unknown as D1Database, ['social.shadow'])).resolves.toBe(variant === 'quarantine' ? 2 : 1);
      expect(f.sqlite.prepare("SELECT state FROM deliveries WHERE id = 'healthy'").get()).toMatchObject({ state: 'verified' });
      expect(f.sqlite.prepare("SELECT state FROM deliveries WHERE id = 'delivery'").get()).toMatchObject({ state: variant === 'quarantine' ? 'needs_attention' : 'processing' });
      expect(f.sqlite.prepare("SELECT receipt_json FROM receipts WHERE delivery_id = 'delivery'").get()).toMatchObject({ receipt_json: '{}' });
      expect(f.sqlite.prepare('SELECT safe_to_delete FROM artifact_references').get()).toMatchObject({ safe_to_delete: 0 });
    } finally { f.sqlite.close(); }
  });
  it('continues the bounded page after an invalid stored receipt', async () => {
    const f = fixture();
    try {
      await consumeDelivery(required(await f.store().load('troco', 'delivery')), f.dependencies);
      f.sqlite.exec(`UPDATE receipts SET receipt_json = '{}';
        UPDATE deliveries SET updated_at = '2000-01-01';
        INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
        SELECT 'healthy', 'other', publication_id, 'healthy', adapter, operation, required, payload_json, 'reconciling' FROM deliveries;`);
      const processed: string[] = [];
      const count = await runD1Reconciliation(f.database, 2, async ({ tenantId, deliveryId }) => {
        if (deliveryId === 'delivery') await f.store().load(tenantId, deliveryId);
        processed.push(deliveryId);
      });
      expect(processed).toEqual(['healthy']);
      expect(count).toBe(1);
    } finally { f.sqlite.close(); }
  });
  it.each(['found', 'unknown', 'absent', 'retention-error', 'malformed', 'provider', 'remote-id', 'stale'] as const)('fresh worker reconciles %s without a second effect', async (variant) => {
    const f = fixture();
    try {
      await consumeDelivery(required(await f.store().load('troco', 'delivery')), f.dependencies);
      const saved = JSON.parse(String(required(f.sqlite.prepare('SELECT receipt_json FROM receipts').get()).receipt_json)) as { provider: string; remoteId: string; acceptedAt: string };
      const loaded = required(await f.store().load('troco', 'delivery'));
      expect(loaded).toMatchObject({ receipt: saved, state: 'processing' });
      const reconcile = vi.spyOn(f.adapter, 'reconcile').mockImplementation(() => {
        if (variant === 'stale') f.sqlite.exec('UPDATE deliveries SET lease_token = lease_token + 1');
        if (variant === 'unknown' || variant === 'absent') return Promise.resolve({ status: variant });
        return Promise.resolve({ status: 'found', receipt: { ...saved, ...(variant === 'malformed' ? { acceptedAt: 'bad' } : {}), ...(variant === 'provider' ? { provider: 'other' } : {}), ...(variant === 'remote-id' ? { remoteId: 'different' } : {}) } });
      });
      const retention = vi.fn(f.adapter.artifactRetention?.bind(f.adapter));
      f.adapter.artifactRetention = retention;
      if (variant === 'retention-error') retention.mockRejectedValue(new Error('Unavailable'));
      else f.adapter.confirmArtifactIngestion('logical');
      const run = runD1Reconciliation(f.database, 10, async () => { await reconcileDelivery(loaded, f.dependencies); });
      if (variant === 'stale') await expect(run).resolves.toBe(0);
      else await expect(run).resolves.toBe(1);
      expect(reconcile).toHaveBeenCalledOnce();
      expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ receipt: saved }));
      expect(f.adapter.effectCount()).toBe(1);
      expect(f.sqlite.prepare('SELECT safe_to_delete FROM artifact_references').get()).toMatchObject({ safe_to_delete: variant === 'found' ? 1 : 0 });
      expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM receipts').get()).toMatchObject({ count: 1 });
      if (variant === 'found' || variant === 'retention-error') {
        expect(retention).toHaveBeenCalledOnce();
        expect(f.sqlite.prepare('SELECT state FROM deliveries').get()).toMatchObject({ state: 'verified' });
      }
      if (['unknown', 'absent', 'malformed', 'provider', 'remote-id'].includes(variant)) {
        expect(retention).not.toHaveBeenCalled();
        expect(f.sqlite.prepare('SELECT state FROM deliveries').get()).toMatchObject({ state: 'reconciling' });
      }
    } finally { f.sqlite.close(); }
  });

  it('does not return a processing delivery with a missing receipt to redelivery', async () => {
    const f = fixture();
    try {
      await consumeDelivery(required(await f.store().load('troco', 'delivery')), f.dependencies);
      f.sqlite.exec('DELETE FROM receipts');
      vi.spyOn(f.adapter, 'reconcile').mockResolvedValue({ status: 'absent' });
      await reconcileDelivery(required(await f.store().load('troco', 'delivery')), f.dependencies);
      expect(f.sqlite.prepare('SELECT state FROM deliveries').get()).toMatchObject({ state: 'needs_attention' });
      expect(f.sqlite.prepare('SELECT safe_to_delete FROM artifact_references').get()).toMatchObject({ safe_to_delete: 0 });
    } finally { f.sqlite.close(); }
  });

  it.each(['malformed', 'provider', 'columns', 'conflict', 'wrong-tenant'] as const)('rejects or isolates stored receipt: %s', async (variant) => {
    const f = fixture();
    try {
      await consumeDelivery(required(await f.store().load('troco', 'delivery')), f.dependencies);
      if (variant === 'malformed') f.sqlite.exec("UPDATE receipts SET receipt_json = '{}'");
      if (variant === 'provider') f.sqlite.exec(`UPDATE receipts SET provider = 'other', receipt_json = json_set(receipt_json, '$.provider', 'other')`);
      if (variant === 'columns') f.sqlite.exec("UPDATE receipts SET remote_id = 'forged'");
      if (variant === 'conflict') f.sqlite.exec(`INSERT INTO receipts (id, tenant_id, delivery_id, provider, remote_id, receipt_json) SELECT 'conflicting', tenant_id, delivery_id, provider, 'other', json_set(receipt_json, '$.remoteId', 'other') FROM receipts`);
      if (variant === 'wrong-tenant') f.sqlite.exec("UPDATE receipts SET tenant_id = 'other'");
      const load = f.store().load('troco', 'delivery');
      if (variant === 'wrong-tenant') expect((await load)).not.toHaveProperty('receipt');
      else await expect(load).rejects.toThrow();
    } finally { f.sqlite.close(); }
  });
});
