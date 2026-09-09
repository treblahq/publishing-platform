import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runD1ArtifactCleanup } from './d1-cleanup.js';

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash)
      VALUES ('producer', 'openings', 'pipeline', 1, 'test-hash');
    INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES ('publication', 'openings', 'producer', 'test', 'source', '1', 'key', '{}', 'accepted');
    INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('delivery', 'openings', 'publication', 'key', 'test', 'publish', 1, '{}', 'succeeded');`);
  addArtifact('a1');
});
afterEach(() => { sqlite.close(); });

function addArtifact(id: string) {
  sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
    VALUES (?, 'openings', 'r2-temporary', ?, 10, 'image/png', ?, 'available')`).run(id, 'a'.repeat(64), `tmp/${id}`);
  sqlite.prepare(`INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
    VALUES ('openings', ?, 'delivery', 1)`).run(id);
}

function database(beforeRun: (sql: string) => void = () => {}) {
  return {
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const statement = {
        bind(...inputs: unknown[]) { values = inputs as SQLInputValue[]; return statement; },
        first: () => Promise.resolve(sqlite.prepare(sql).get(...values) ?? null),
        all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...values) }),
        run: () => {
          beforeRun(sql);
          const result = sqlite.prepare(sql).run(...values);
          return Promise.resolve({ meta: { changes: Number(result.changes) } });
        },
      };
      return statement;
    },
  };
}

function artifact() {
  return sqlite.prepare('SELECT state, tombstoned_at, deleted_at FROM artifacts WHERE id = ?').get('a1');
}

function cursor() {
  return sqlite.prepare("SELECT cursor FROM maintenance_cursors WHERE name = 'artifact-cleanup'").get();
}

describe('artifact cleanup against actual migrations', () => {
  it.each([null, '2000-01-02T00:00:00.000Z'])('does not treat expired or revoked public approval as provider ingestion (%s)', async (revokedAt) => {
    sqlite.exec(`UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z';
      UPDATE artifact_references SET safe_to_delete = 0;
      UPDATE deliveries SET state = 'needs_attention'`);
    sqlite.prepare(`INSERT INTO public_media_grants
      (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at, revoked_at)
      VALUES ('openings', 'a1', 'delivery', ?, '2000-01-01T00:00:00.000Z', '2000-01-02T00:00:00.000Z', ?)`)
      .run('a'.repeat(64), revokedAt);
    let deletes = 0;
    const bucket = { delete: () => { deletes++; return Promise.resolve(); } };
    expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(0);
    expect(deletes).toBe(0);
    sqlite.exec('UPDATE artifact_references SET safe_to_delete = 1');
    expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(1);
    expect(deletes).toBe(1);
  });

  it.each(['available', 'staged', 'tombstoned'])('retains %s media for an accepted provider until its reference is released', async (state) => {
    sqlite.prepare("UPDATE artifacts SET state = ?, created_at = '2000-01-01T00:00:00.000Z'").run(state);
    sqlite.exec(`UPDATE artifact_references SET safe_to_delete = 0;
      UPDATE deliveries SET state = 'needs_attention';
      INSERT INTO receipts (id, tenant_id, delivery_id, provider, remote_id, receipt_json)
      VALUES ('receipt', 'openings', 'delivery', 'test', 'remote-1', '{}')`);
    const deleted: string[] = [];
    const bucket = { delete: (key: string) => { deleted.push(key); return Promise.resolve(); } };
    expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(0);
    expect(deleted).toEqual([]);
    expect(artifact()?.state).toBe(state);
    sqlite.exec('UPDATE artifact_references SET safe_to_delete = 1');
    expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(1);
    expect(deleted).toEqual(['tmp/a1']);
  });

  it.each(['receipt', 'grant'])('rechecks %s appearing between selection and tombstone claim', async (evidence) => {
    sqlite.exec(`UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z';
      UPDATE artifact_references SET safe_to_delete = 0;
      UPDATE deliveries SET state = 'needs_attention'`);
    const db = database((sql) => {
      if (!sql.includes("SET state = 'tombstoned'")) return;
      if (evidence === 'receipt') sqlite.exec(`INSERT INTO receipts
          (id, tenant_id, delivery_id, provider, remote_id, receipt_json)
          VALUES ('receipt', 'openings', 'delivery', 'test', 'remote-1', '{}')`);
      else sqlite.prepare(`INSERT INTO public_media_grants
        (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at)
        VALUES ('openings', 'a1', 'delivery', ?, '2000-01-01T00:00:00.000Z', '2000-01-02T00:00:00.000Z')`)
        .run('a'.repeat(64));
    });
    let deletes = 0;
    expect(await runD1ArtifactCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
    expect(artifact()).toEqual({ state: 'available', tombstoned_at: null, deleted_at: null });
  });

  it('waits for the last accepted provider reference rather than the first release', async () => {
    sqlite.exec(`UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z';
      UPDATE deliveries SET state = 'needs_attention';
      INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
        VALUES ('second', 'openings', 'publication', 'second', 'another', 'publish', 1, '{}', 'needs_attention');
      INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
        VALUES ('openings', 'a1', 'second', 0);
      INSERT INTO receipts (id, tenant_id, delivery_id, provider, remote_id, receipt_json)
        VALUES ('receipt', 'openings', 'second', 'another', 'remote-2', '{}')`);
    let deletes = 0;
    const bucket = { delete: () => { deletes++; return Promise.resolve(); } };
    expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(0);
    expect(deletes).toBe(0);
    sqlite.exec("UPDATE artifact_references SET safe_to_delete = 1 WHERE delivery_id = 'second'");
    expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(1);
    expect(deletes).toBe(1);
  });

  it.each([{}, { meta: {} }, { meta: { changes: '1' } }, { meta: { changes: 2 } }, { meta: { changes: -1 } }])(
    'fails closed when the tombstone result does not confirm one affected row: %j', async (claimResult) => {
      const actual = database();
      const db = {
        prepare(sql: string) {
          const statement = actual.prepare(sql);
          if (sql.includes("SET state = 'tombstoned'")) {
            statement.run = () => Promise.resolve(claimResult as { meta: { changes: number } });
          }
          return statement;
        },
      };
      let deletes = 0;
      await expect(runD1ArtifactCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10))
        .rejects.toThrow('Artifact cleanup claim could not be confirmed');
      expect(deletes).toBe(0);
      expect(cursor()).toBeUndefined();
      expect(artifact()).toEqual({ state: 'available', tombstoned_at: null, deleted_at: null });
    },
  );

  it.each([
    ['reference becomes unsafe', "UPDATE artifact_references SET safe_to_delete = 0"],
    ['delivery starts reconciling', "UPDATE deliveries SET state = 'reconciling'"],
    ['storage changes', "UPDATE artifacts SET storage = 'external'"],
    ['another collector finishes', "UPDATE artifacts SET state = 'deleted'"],
  ])('rejects the claim when %s after selection', async (_name, change) => {
    const deleted: string[] = [];
    let finalMarks = 0;
    const db = database((sql) => {
      if (sql.includes("SET state = 'tombstoned'")) sqlite.exec(change);
      if (sql.includes("SET state = 'deleted'")) finalMarks++;
    });
    expect(await runD1ArtifactCleanup(db, { delete: (key) => { deleted.push(key); return Promise.resolve(); } }, 10)).toBe(0);
    expect(deleted).toEqual([]);
    expect(finalMarks).toBe(0);
    expect(artifact()).toMatchObject({ tombstoned_at: null, deleted_at: null });
    expect(cursor()).toEqual({ cursor: 'a1' });
    expect(await runD1ArtifactCleanup(database(), { delete: () => Promise.resolve() }, 10)).toBe(0);
    expect(cursor()).toEqual({ cursor: '' });
  });

  it('deletes an eligible artifact and advances the cursor', async () => {
    const deleted: string[] = [];
    expect(await runD1ArtifactCleanup(database(), { delete: (key) => { deleted.push(key); return Promise.resolve(); } }, 10)).toBe(1);
    expect(deleted).toEqual(['tmp/a1']);
    expect(artifact()?.state).toBe('deleted');
    expect(typeof artifact()?.tombstoned_at).toBe('string');
    expect(typeof artifact()?.deleted_at).toBe('string');
    expect(cursor()).toEqual({ cursor: 'a1' });
  });

  it.each([
    ['unreferenced', 'DELETE FROM artifact_references', 1],
    ['old staged', "UPDATE artifacts SET state = 'staged', created_at = '2000-01-01T00:00:00.000Z'", 1],
    ['old terminal', "UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z'; UPDATE deliveries SET state = 'failed_terminal'", 1],
    ['young unsafe', '', 0],
    ['old active', "UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z'; UPDATE deliveries SET state = 'ready'", 0],
    ['old staged reconciling', "UPDATE artifacts SET state = 'staged', created_at = '2000-01-01T00:00:00.000Z'; UPDATE deliveries SET state = 'reconciling'", 0],
    ['tombstoned reconciling', "UPDATE artifacts SET state = 'tombstoned'; UPDATE deliveries SET state = 'reconciling'", 0],
  ])('preserves retention eligibility for %s artifacts', async (_name, setup, expected) => {
    sqlite.exec('UPDATE artifact_references SET safe_to_delete = 0');
    if (setup) sqlite.exec(setup);
    let deletes = 0;
    expect(await runD1ArtifactCleanup(database(), { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(expected);
    expect(deletes).toBe(expected);
  });

  it('rechecks retention when an old terminal delivery becomes active after selection', async () => {
    sqlite.exec(`UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z';
      UPDATE artifact_references SET safe_to_delete = 0;
      UPDATE deliveries SET state = 'failed_terminal'`);
    const db = database((sql) => {
      if (sql.includes("SET state = 'tombstoned'")) sqlite.exec("UPDATE deliveries SET state = 'ready'");
    });
    let deletes = 0;
    expect(await runD1ArtifactCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
    expect(artifact()).toEqual({ state: 'available', tombstoned_at: null, deleted_at: null });
  });

  it('rechecks eligibility when an unsafe reference is inserted after selection', async () => {
    sqlite.exec('DELETE FROM artifact_references');
    const db = database((sql) => {
      if (sql.includes("SET state = 'tombstoned'")) {
        sqlite.exec(`INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
          VALUES ('openings', 'a1', 'delivery', 0)`);
      }
    });
    let deletes = 0;
    expect(await runD1ArtifactCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
    expect(artifact()).toEqual({ state: 'available', tombstoned_at: null, deleted_at: null });
  });

  it('retries a failed bucket deletion without replacing the tombstone timestamp', async () => {
    await expect(runD1ArtifactCleanup(database(), { delete: () => Promise.reject(new Error('bucket unavailable')) }, 10))
      .rejects.toThrow('bucket unavailable');
    const tombstone = artifact();
    expect(tombstone).toMatchObject({ state: 'tombstoned', deleted_at: null });
    expect(typeof tombstone?.tombstoned_at).toBe('string');
    expect(cursor()).toBeUndefined();
    sqlite.exec('UPDATE artifact_references SET safe_to_delete = 0');
    expect(await runD1ArtifactCleanup(database(), { delete: () => Promise.resolve() }, 10)).toBe(1);
    expect(artifact()).toMatchObject({ state: 'deleted', tombstoned_at: tombstone?.tombstoned_at });
  });

  it('protects a tombstoned retry if reconciliation begins between selection and claim', async () => {
    sqlite.exec("UPDATE artifacts SET state = 'tombstoned', tombstoned_at = '2000-01-01T00:00:00.000Z'");
    const db = database((sql) => {
      if (sql.includes("SET state = 'tombstoned'")) sqlite.exec("UPDATE deliveries SET state = 'reconciling'");
    });
    let deletes = 0;
    expect(await runD1ArtifactCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
    expect(artifact()).toEqual({ state: 'tombstoned', tombstoned_at: '2000-01-01T00:00:00.000Z', deleted_at: null });
  });

  it('counts only successful deletions while advancing past skipped candidates', async () => {
    addArtifact('a2');
    addArtifact('a3');
    const db = database((sql) => {
      if (sql.includes("SET state = 'tombstoned'")) {
        sqlite.exec("UPDATE artifact_references SET safe_to_delete = 0 WHERE artifact_id IN ('a1', 'a3')");
      }
    });
    const deleted: string[] = [];
    expect(await runD1ArtifactCleanup(db, { delete: (key) => { deleted.push(key); return Promise.resolve(); } }, 3)).toBe(1);
    expect(deleted).toEqual(['tmp/a2']);
    expect(cursor()).toEqual({ cursor: 'a3' });
    expect(sqlite.prepare('SELECT id, state FROM artifacts ORDER BY id').all()).toEqual([
      { id: 'a1', state: 'available' }, { id: 'a2', state: 'deleted' }, { id: 'a3', state: 'available' },
    ]);
  });
});
