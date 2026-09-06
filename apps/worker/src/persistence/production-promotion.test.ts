import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = resolve('apps/worker/migrations');
const migrations = [
  '0001_core.sql', '0002_capacity.sql', '0003_maintenance.sql',
  '0004_capacity_reservations.sql', '0005_web_entities.sql',
  '0006_outbox_claims.sql', '0007_artifact_uploads.sql',
].map((name) => resolve(migrationDirectory, name));
const promotionMigration = resolve(migrationDirectory, '0008_promote_incomplete_web_deliveries.sql');

describe('production promotion migration', () => {
  it('requeues only incomplete R2 web work whose old queue dispatch is stranded', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    for (const path of migrations) database.exec(readFileSync(path, 'utf8'));
    database.exec("INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1)");
    database.exec("INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('client', 'openings', 'pipeline', 1, 'hash')");

    const cases: Array<[id: string, adapter: string, state: string]> = [
      ['planned', 'web.r2', 'planned'], ['ready', 'web.r2', 'ready'],
      ['attention', 'web.r2', 'needs_attention'], ['verified', 'web.r2', 'verified'],
      ['social', 'social.linkedin', 'needs_attention'],
    ];
    for (const [id, adapter, state] of cases) {
      database.prepare(`INSERT INTO publications
        (id, tenant_id, producer_client_id, source_type, source_id, revision,
         idempotency_key, envelope_json, state)
        VALUES (?, 'openings', 'client', 'job', ?, 'r1', ?, '{}', 'accepted')`)
        .run(`publication-${id}`, id, `key-${id}`);
      database.prepare(`INSERT INTO deliveries
        (id, tenant_id, publication_id, delivery_key, adapter, operation, required,
         payload_json, state, lease_token, lease_expires_at)
        VALUES (?, 'openings', ?, 'delivery', ?, 'publish', 1, '{}', ?, 4,
                '2099-01-01T00:00:00.000Z')`)
        .run(id, `publication-${id}`, adapter, state);
      database.prepare(`INSERT INTO outbox
        (id, tenant_id, delivery_id, event_type, payload_json, due_at,
         dispatched_at, attempts, claim_token, claimed_until)
        VALUES (?, 'openings', ?, 'delivery.ready', '{}',
                '2026-09-05T00:00:00.000Z', '2026-09-05T00:01:00.000Z', 1,
                'old-claim', '2099-01-01T00:00:00.000Z')`)
        .run(`outbox-${id}`, id);
    }

    database.exec(readFileSync(promotionMigration, 'utf8'));

    const deliveries = database.prepare(`SELECT id, state, lease_expires_at
      FROM deliveries ORDER BY id`).all();
    expect(deliveries).toEqual([
      { id: 'attention', state: 'ready', lease_expires_at: null },
      { id: 'planned', state: 'ready', lease_expires_at: null },
      { id: 'ready', state: 'ready', lease_expires_at: null },
      { id: 'social', state: 'needs_attention', lease_expires_at: '2099-01-01T00:00:00.000Z' },
      { id: 'verified', state: 'verified', lease_expires_at: '2099-01-01T00:00:00.000Z' },
    ]);
    expect(database.prepare(`SELECT id, delivery_id, dispatched_at, attempts,
      claim_token, claimed_until FROM outbox
      WHERE id LIKE 'production-promotion:%' ORDER BY delivery_id`).all()).toEqual([
      { id: 'production-promotion:attention', delivery_id: 'attention', dispatched_at: null, attempts: 0, claim_token: null, claimed_until: null },
      { id: 'production-promotion:planned', delivery_id: 'planned', dispatched_at: null, attempts: 0, claim_token: null, claimed_until: null },
      { id: 'production-promotion:ready', delivery_id: 'ready', dispatched_at: null, attempts: 0, claim_token: null, claimed_until: null },
    ]);
  });
});
