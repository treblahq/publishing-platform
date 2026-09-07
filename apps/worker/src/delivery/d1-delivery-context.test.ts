import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createD1DeliveryStore } from './d1-delivery-store.js';

describe('approved delivery context on the real database schema', () => {
  it.each(['valid', 'tenant', 'payload', 'hash', 'size', 'duplicate-logical-id'] as const)('validates immutable context: %s', async (variant) => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync('apps/worker/migrations/0001_core.sql', 'utf8'));
    const artifact = { id: 'logical-video', storage: 'r2-temporary', sha256: 'a'.repeat(64), byteSize: 10, mediaType: 'video/mp4', locator: 'temporary/troco/video.mp4' };
    const payload = { type: 'social.post', text: 'Approved', artifactIds: [artifact.id] };
    const providerOptions = { channel: 'instagram', targetAt: '2026-09-08T12:00:00.000Z' };
    const envelope = { schemaVersion: 1, identity: { tenant: variant === 'tenant' ? 'other' : 'troco', sourceType: 'campaign', sourceId: 'campaign', revision: '1', idempotencyKey: 'key' }, canonical: { title: 'Approved', language: 'pt-BR' }, artifacts: variant === 'duplicate-logical-id' ? [artifact, artifact] : [artifact], deliveries: [{ id: 'instagram', adapter: 'social.shadow', operation: 'compare', required: false, payload, providerOptions }] };
    sqlite.exec(`
      INSERT INTO tenants (id, name, enabled) VALUES ('troco', 'Troco', 1);
      INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('client', 'troco', 'publisher', 1, 'hash');
    `);
    sqlite.prepare(`INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES ('publication', 'troco', 'client', 'campaign', 'campaign', '1', 'key', ?, 'accepted')`).run(JSON.stringify(envelope));
    sqlite.prepare(`INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('database-delivery', 'troco', 'publication', 'instagram', 'social.shadow', 'compare', 0, ?, 'ready')`).run(JSON.stringify(variant === 'payload' ? { ...payload, text: 'Changed' } : payload));
    sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
      VALUES ('database-artifact', 'troco', 'r2-temporary', ?, ?, 'video/mp4', ?, 'available')`).run(variant === 'hash' ? 'b'.repeat(64) : artifact.sha256, variant === 'size' ? 11 : 10, artifact.locator);
    sqlite.exec("INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id) VALUES ('troco', 'database-artifact', 'database-delivery')");
    let reads = 0;
    const database = {
      prepare(sql: string) {
        reads++;
        let bindings: SQLInputValue[] = [];
        return {
          bind(...values: unknown[]) { bindings = values as SQLInputValue[]; return this; },
          first: () => Promise.resolve(sqlite.prepare(sql).get(...bindings) ?? null),
          all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...bindings) }),
        };
      },
      batch: () => Promise.resolve([]),
    };
    try {
      const result = createD1DeliveryStore(database, () => ({ trusted: true })).load('troco', 'database-delivery');
      if (variant !== 'valid') await expect(result).rejects.toThrow();
      else {
        await expect(result).resolves.toMatchObject({ providerOptions, payload, artifacts: [artifact], artifactStorageIds: { 'logical-video': 'database-artifact' }, config: { trusted: true } });
        expect(reads).toBe(2);
      }
    } finally { sqlite.close(); }
  });
});
