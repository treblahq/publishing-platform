import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicationEnvelope } from '@trebla/publishing';
import { verifyTemporaryArtifacts } from '../artifacts/verify-uploads.js';
import { runD1UploadCleanup } from '../cleanup/d1-cleanup.js';
import { createD1IntakeStore, type D1IntakeStatement } from './d1-intake-store.js';

const acceptedAt = '2000-01-01T00:00:00.000Z';
const sha256 = 'a'.repeat(64);
const locator = 'temporary/openings/image.png';
const principal = { tenant: 'openings', clientId: 'producer', nonce: 'nonce-1' };
const envelope: PublicationEnvelope = {
  schemaVersion: 1,
  identity: { tenant: 'openings', sourceType: 'job', sourceId: 'job-1', revision: 'rev-1', idempotencyKey: 'idem-1' },
  canonical: { title: 'Engineer', language: 'en' },
  artifacts: [{ id: 'image', storage: 'r2-temporary', sha256, byteSize: 10, mediaType: 'image/png', locator }],
  deliveries: [{ id: 'web', adapter: 'web.pages', operation: 'publish', required: true,
    payload: { type: 'web.page', route: '/jobs/job-1' } }],
};

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('other', 'Other', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash)
      VALUES ('producer', 'openings', 'pipeline', 1, 'test-hash'), ('other-producer', 'openings', 'other', 1, 'test-hash');
    INSERT INTO capacity_reservations (id, tenant_id, resource, amount, state, expires_at)
      VALUES ('reservation', 'openings', 'r2Bytes', 10, 'reserved', '2000-01-02T00:00:00.000Z');
    INSERT INTO artifact_uploads
      (id, tenant_id, producer_client_id, locator, sha256, byte_size, media_type, state, capacity_reservation_id, expires_at)
      VALUES ('upload', 'openings', 'producer', '${locator}', '${sha256}', 10,
        'image/png', 'available', 'reservation', '2000-01-02T00:00:00.000Z');`);
});
afterEach(() => { sqlite.close(); });

function database() {
  const executions = new Map<D1IntakeStatement, () => unknown>();
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const statement = {
        bind(...inputs: unknown[]) { values = inputs as SQLInputValue[]; return statement; },
        first<T>() { return Promise.resolve((sqlite.prepare(sql).get(...values) ?? null) as T | null); },
        all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...values) }),
        run: () => Promise.resolve({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
      };
      executions.set(statement, () => sqlite.prepare(sql).run(...values));
      return statement;
    },
    batch(statements: D1IntakeStatement[]) {
      sqlite.exec('BEGIN');
      try {
        for (const statement of statements) {
          const execute = executions.get(statement);
          if (!execute) throw new Error('Unknown statement');
          execute();
        }
        sqlite.exec('COMMIT');
        return Promise.resolve();
      } catch (error) {
        sqlite.exec('ROLLBACK');
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
}

function store(db = database()) {
  let sequence = 0;
  return createD1IntakeStore(db, () => `id-${String(++sequence)}`, () => acceptedAt);
}

function snapshot() {
  const tables = ['tenants', 'producer_clients', 'artifact_uploads', 'nonces', 'publications', 'source_leases',
    'artifacts', 'deliveries', 'delivery_dependencies', 'artifact_references', 'capacity_reservations',
    'capacity_usage', 'audit_events', 'outbox'];
  return Object.fromEntries(tables.map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

describe('atomic intake temporary upload fencing against actual migrations', () => {
  it('rolls back acceptance when the upload fails after successful metadata and object preflight', async () => {
    const db = database();
    expect(await verifyTemporaryArtifacts(db, {
      head: () => Promise.resolve({ size: 10, customMetadata: { tenant: 'openings', sha256, mediaType: 'image/png' },
        checksums: { sha256: new Uint8Array(32).fill(0xaa).buffer } }),
    }, principal.tenant, envelope)).toBe(true);
    sqlite.exec("UPDATE artifact_uploads SET state = 'failed'");
    const before = snapshot();
    await expect(store(db).acceptAtomic({ principal, envelope })).rejects.toThrow('NOT NULL constraint failed: artifacts.locator');
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['missing', 'DELETE FROM artifact_uploads'],
    ['uploading', "UPDATE artifact_uploads SET state = 'uploading'"],
    ['failed', "UPDATE artifact_uploads SET state = 'failed'"],
    ['deleted', "UPDATE artifact_uploads SET state = 'deleted'"],
    ['expired available', "UPDATE artifact_uploads SET expires_at = '1999-12-31T23:59:59.000Z'"],
    ['expiry equal to acceptance', `UPDATE artifact_uploads SET expires_at = '${acceptedAt}'`],
    ['invalid expiry', "UPDATE artifact_uploads SET expires_at = 'invalid'"],
    ['wrong hash', `UPDATE artifact_uploads SET sha256 = '${'b'.repeat(64)}'`],
    ['wrong size', 'UPDATE artifact_uploads SET byte_size = 11'],
    ['wrong MIME', "UPDATE artifact_uploads SET media_type = 'image/jpeg'"],
    ['wrong tenant', "UPDATE artifact_uploads SET tenant_id = 'other'"],
    ['wrong locator', "UPDATE artifact_uploads SET locator = 'temporary/openings/other.png'"],
    ['deleted timestamp', `UPDATE artifact_uploads SET deleted_at = '${acceptedAt}'`],
    ['claimed with deleted timestamp', `UPDATE artifact_uploads SET state = 'claimed', deleted_at = '${acceptedAt}'`],
  ])('rejects %s and preserves all existing state', async (_name, mutation) => {
    sqlite.exec(mutation);
    const before = snapshot();
    await expect(store().acceptAtomic({ principal, envelope })).rejects.toThrow('NOT NULL constraint failed: artifacts.locator');
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['available', '2000-01-02T00:00:00.000Z', 'producer'],
    ['available', '1999-12-31T23:30:00-01:00', 'other-producer'],
    ['claimed', '1999-12-31T00:00:00.000Z', 'producer'],
  ])('accepts valid %s uploads with expiry %s from %s', async (state, expiry, producer) => {
    sqlite.prepare('UPDATE artifact_uploads SET state = ?, expires_at = ?, producer_client_id = ?').run(state, expiry, producer);
    await expect(store().acceptAtomic({ principal, envelope })).resolves.toBe('id-1');
    expect(sqlite.prepare('SELECT state, claimed_at FROM artifact_uploads').get())
      .toEqual({ state: 'claimed', claimed_at: acceptedAt });
    expect(sqlite.prepare('SELECT state, locator FROM artifacts').get()).toEqual({ state: 'available', locator });
    expect(sqlite.prepare('SELECT artifact_id, delivery_id, safe_to_delete FROM artifact_references').get())
      .toEqual({ artifact_id: 'id-3', delivery_id: 'id-2', safe_to_delete: 0 });
    expect(sqlite.prepare("SELECT state FROM capacity_reservations WHERE id = 'reservation'").get())
      .toEqual({ state: 'reserved' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM outbox').get()).toEqual({ count: 1 });
  });

  it('rolls back an earlier artifact insertion and upload claim if a later artifact is unavailable', async () => {
    const before = snapshot();
    const secondArtifact = { id: 'missing', storage: 'r2-temporary' as const, sha256: 'b'.repeat(64),
      byteSize: 20, mediaType: 'image/png', locator: 'temporary/openings/missing.png' };
    await expect(store().acceptAtomic({ principal, envelope: {
      ...envelope, artifacts: [...envelope.artifacts, secondArtifact],
    } })).rejects.toThrow('NOT NULL constraint failed: artifacts.locator');
    expect(snapshot()).toEqual(before);
  });

  it('preserves existing idempotency lookup and unique artifact behavior', async () => {
    const intake = store();
    await intake.acceptAtomic({ principal, envelope });
    const before = snapshot();
    await expect(intake.findByIdempotencyKey({ principal, envelope })).resolves.toBe('id-1');
    await expect(intake.acceptAtomic({ principal: { ...principal, nonce: 'nonce-2' }, envelope: {
      ...envelope, identity: { ...envelope.identity, sourceId: 'job-2', idempotencyKey: 'idem-2' },
    } })).rejects.toThrow('UNIQUE constraint failed: artifacts.tenant_id, artifacts.sha256, artifacts.storage, artifacts.locator');
    expect(snapshot()).toEqual(before);
  });

  it.each(['external', 'r2-live'] as const)('preserves %s acceptance without an upload ledger entry', async (storage) => {
    sqlite.exec('DELETE FROM artifact_uploads');
    await expect(store().acceptAtomic({ principal, envelope: {
      ...envelope, artifacts: envelope.artifacts.map((artifact) => ({ ...artifact, storage })),
    } })).resolves.toBe('id-1');
    expect(sqlite.prepare('SELECT state, locator FROM artifacts').get()).toEqual({ state: 'staged', locator });
  });

  it('rejects intake inside cleanup deletion after cleanup wins its failed-state claim', async () => {
    const db = database();
    const deleted: string[] = [];
    expect(await runD1UploadCleanup(db, { delete: async (key) => {
      expect(sqlite.prepare('SELECT state FROM artifact_uploads').get()).toEqual({ state: 'failed' });
      const before = snapshot();
      await expect(store(db).acceptAtomic({ principal, envelope })).rejects.toThrow('NOT NULL constraint failed: artifacts.locator');
      expect(snapshot()).toEqual(before);
      deleted.push(key);
    } }, 10)).toBe(1);
    expect(deleted).toEqual([locator]);
    expect(sqlite.prepare('SELECT state FROM artifact_uploads').get()).toEqual({ state: 'deleted' });
    expect(sqlite.prepare('SELECT state FROM capacity_reservations').get()).toEqual({ state: 'released' });
  });

  it('does not delete a claimed upload when intake wins before cleanup', async () => {
    const db = database();
    await store(db).acceptAtomic({ principal, envelope });
    const before = snapshot();
    const deleted: string[] = [];
    expect(await runD1UploadCleanup(db, { delete: (key) => { deleted.push(key); return Promise.resolve(); } }, 10)).toBe(0);
    expect(deleted).toEqual([]);
    expect(snapshot()).toEqual(before);
  });
});
