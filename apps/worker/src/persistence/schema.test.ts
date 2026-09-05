import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const migrationPath = resolve('apps/worker/migrations/0001_core.sql');
const capacityMigrationPath = resolve('apps/worker/migrations/0002_capacity.sql');
const maintenanceMigrationPath = resolve('apps/worker/migrations/0003_maintenance.sql');
const reservationMigrationPath = resolve('apps/worker/migrations/0004_capacity_reservations.sql');
const webEntitiesMigrationPath = resolve('apps/worker/migrations/0005_web_entities.sql');
const outboxClaimsMigrationPath = resolve('apps/worker/migrations/0006_outbox_claims.sql');
let database: DatabaseSync;

beforeEach(() => {
  expect(existsSync(migrationPath)).toBe(true);
  expect(existsSync(capacityMigrationPath)).toBe(true);
  expect(existsSync(maintenanceMigrationPath)).toBe(true);
  expect(existsSync(reservationMigrationPath)).toBe(true);
  expect(existsSync(webEntitiesMigrationPath)).toBe(true);
  expect(existsSync(outboxClaimsMigrationPath)).toBe(true);
  database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(readFileSync(migrationPath, 'utf8'));
  database.exec(readFileSync(capacityMigrationPath, 'utf8'));
  database.exec(readFileSync(maintenanceMigrationPath, 'utf8'));
  database.exec(readFileSync(reservationMigrationPath, 'utf8'));
  database.exec(readFileSync(webEntitiesMigrationPath, 'utf8'));
  database.exec(readFileSync(outboxClaimsMigrationPath, 'utf8'));
  database.prepare("INSERT INTO tenants (id, name, enabled) VALUES ('tenant-1', 'openings', 1)").run();
  database.prepare("INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('client-1', 'tenant-1', 'pipeline', 1, 'hash')").run();
});

function insertPublication(id = 'publication-1', idempotencyKey = 'idem-1') {
  database.prepare(`
    INSERT INTO publications
      (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
    VALUES (?, 'tenant-1', 'client-1', 'job', 'job-1', 'rev-1', ?, '{}', 'accepted')
  `).run(id, idempotencyKey);
}

describe('authoritative D1 schema', () => {
  it('rejects a duplicate tenant idempotency key', () => {
    insertPublication();
    expect(() => {
      insertPublication('publication-2');
    }).toThrow();
  });

  it('rejects nonce replay for one producer client', () => {
    database.prepare("INSERT INTO nonces (producer_client_id, nonce, expires_at) VALUES ('client-1', 'nonce-1', '2026-09-05T00:00:00.000Z')").run();
    expect(() => {
      database.prepare("INSERT INTO nonces (producer_client_id, nonce, expires_at) VALUES ('client-1', 'nonce-1', '2026-09-05T00:00:00.000Z')").run();
    }).toThrow();
  });

  it('rejects duplicate delivery keys inside a publication', () => {
    insertPublication();
    const insert = database.prepare("INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state) VALUES (?, 'tenant-1', 'publication-1', 'web', 'web.pages', 'publish', 1, '{}', 'planned')");
    insert.run('delivery-1');
    expect(() => {
      insert.run('delivery-2');
    }).toThrow();
  });

  it('rejects duplicate provider receipts for a delivery', () => {
    insertPublication();
    database.prepare("INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state) VALUES ('delivery-1', 'tenant-1', 'publication-1', 'web', 'web.pages', 'publish', 1, '{}', 'planned')").run();
    const insert = database.prepare("INSERT INTO receipts (id, tenant_id, delivery_id, provider, remote_id, receipt_json) VALUES (?, 'tenant-1', 'delivery-1', 'pages', 'remote-1', '{}')");
    insert.run('receipt-1');
    expect(() => {
      insert.run('receipt-2');
    }).toThrow();
  });

  it('rolls back the whole transaction after a constraint failure', () => {
    database.exec('BEGIN');
    try {
      insertPublication();
      insertPublication('publication-2');
      database.exec('COMMIT');
    } catch {
      database.exec('ROLLBACK');
    }
    const row = database.prepare('SELECT COUNT(*) AS count FROM publications').get() as { count: number };
    expect(row.count).toBe(0);
  });

  it('rejects capacity limits that could permit paid overage', () => {
    expect(() => {
      database.prepare("INSERT INTO capacity_limits (resource, free_allowance, internal_limit, warning_limit, reject_limit) VALUES ('r2_bytes', 1000, 800, 600, 700)").run();
    }).toThrow();
    expect(() => {
      database.prepare("INSERT INTO capacity_limits (resource, free_allowance, internal_limit, warning_limit, reject_limit) VALUES ('r2_bytes', 1000, 700, 600, 700)").run();
    }).not.toThrow();
  });

  it('atomically prevents one tenant from consuming capacity reserved by another', () => {
    database.prepare("INSERT INTO tenants (id, name, enabled) VALUES ('tenant-2', 'troco', 1)").run();
    database.prepare("UPDATE capacity_limits SET reject_limit = 70, warning_limit = 60, internal_limit = 100, free_allowance = 143 WHERE resource = 'queueOperations'").run();
    const reserve = database.prepare(`INSERT INTO capacity_reservations
      (id, tenant_id, resource, amount, state, expires_at) VALUES (?, ?, 'queueOperations', ?, 'reserved', '2099-01-01T00:00:00.000Z')`);
    reserve.run('reservation-1', 'tenant-1', 60);
    expect(() => reserve.run('reservation-2', 'tenant-2', 11)).toThrow();
    const row = database.prepare("SELECT COUNT(*) AS count FROM capacity_reservations WHERE tenant_id = 'tenant-2'").get() as { count: number };
    expect(row.count).toBe(0);
  });
});
