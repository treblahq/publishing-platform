import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1OpeningsBridgeStore } from './d1-openings-bridge.js';

function manifest(generation = 1) {
  return { schemaVersion: 1, tenant: 'openings', jobId: 'job', entityRevision: 'r1',
    entityContentSha256: 'a'.repeat(64), generation, media: [
      { role: 'opengraph', artifactId: 'artifact_12345678', sha256: 'b'.repeat(64), byteSize: 10,
        mediaType: 'image/png', width: 1200, height: 630, renderVersion: '1' },
    ] };
}
let sqlite: DatabaseSync;
let queries: string[];
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  queries = [];
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('other', 'Other', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('p', 'openings', 'p', 1, 'test');
    INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES ('pub', 'openings', 'p', 'job', 'job', 'r1', 'key', '{}', 'accepted');
    INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('d', 'openings', 'pub', 'key', 'social.real', 'publish', 1, '{}', 'ready');
    INSERT INTO adapter_controls (tenant_id, adapter, enabled) VALUES ('openings', 'social.real', 1);`);
  sqlite.prepare(`INSERT INTO web_entity_manifests
    (tenant_id, kind, entity_id, revision, status, title, canonical_path, content_sha256, object_key)
    VALUES ('openings', 'job', 'job', 'r1', 'active', 'Job', '/jobs/job', ?, 'entity.json')`).run('a'.repeat(64));
  sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
    VALUES ('artifact_12345678', 'openings', 'r2-temporary', ?, 10, 'image/png', 'temporary/openings/a', 'available')`).run('b'.repeat(64));
  sqlite.exec(`INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
    VALUES ('openings', 'artifact_12345678', 'd', 0)`);
});
afterEach(() => { sqlite.close(); });
function database(before: (sql: string) => void = () => {}) {
  return { prepare(sql: string) {
    return { bind(...values: unknown[]) {
      return { first: () => {
        queries.push(sql); before(sql);
        return Promise.resolve(sqlite.prepare(sql).get(...values as SQLInputValue[]) ?? null);
      } };
    } };
  } };
}
function store(adapters: string[] = ['social.real']) { return createD1OpeningsBridgeStore(database(), adapters); }
function sourceSnapshot() {
  return ['web_entity_manifests', 'artifacts', 'artifact_references', 'public_media_grants', 'deliveries'].map(
    (table) => sqlite.prepare(`SELECT * FROM ${table}`).all());
}
describe('D1 immutable Openings bridge with actual migrations', () => {
  it('binds, reads only manifest fields, and does not mutate source/retention/approval tables', async () => {
    const before = sourceSnapshot();
    const s = store();
    expect(await s.accept(manifest())).toBe('accepted');
    expect(await s.read('job')).toEqual(manifest());
    expect(sourceSnapshot()).toEqual(before);
    expect(sqlite.prepare('SELECT count(*) AS n FROM openings_job_media_bridges').get()?.n).toBe(1);
  });
  it('allows reordered current replay with zero writes and rejects conflicts, stale or skipped generations', async () => {
    const s = store(); const input = manifest();
    input.media.push({ ...input.media[0], role: 'instagram-feed' } as typeof input.media[number]);
    expect(await s.accept(input)).toBe('accepted');
    const changes = sqlite.prepare('SELECT total_changes() AS n').get()?.n;
    expect(await s.accept({ ...input, media: [...input.media].reverse() })).toBe('replayed');
    expect(sqlite.prepare('SELECT total_changes() AS n').get()?.n).toBe(changes);
    expect(await s.accept(manifest())).toBe('rejected');
    expect(await s.accept(manifest(3))).toBe('rejected');
    expect(await s.accept(manifest(2))).toBe('accepted');
    expect(await s.accept(input)).toBe('rejected');
    expect(await s.read('job')).toEqual(manifest(2));
  });
  it('rejects a skipped first generation and serializes concurrent conflicting writers', async () => {
    expect(await store().accept(manifest(2))).toBe('rejected');
    const alternate = manifest();
    if (alternate.media[0]) alternate.media[0].renderVersion = '2';
    expect((await Promise.all([store().accept(manifest()), store().accept(alternate)])).sort()).toEqual(['accepted', 'rejected']);
    expect(sqlite.prepare('SELECT count(*) AS n FROM openings_job_media_bridges').get()?.n).toBe(1);
  });
  it('increments generations across opaque revisions without inheriting prior media', async () => {
    const s = store(); await s.accept(manifest());
    sqlite.exec("UPDATE web_entity_manifests SET revision = 'new-revision'");
    expect(await s.read('job')).toBeNull();
    expect(await s.accept(manifest())).toBe('rejected');
    expect(await s.accept({ ...manifest(), entityRevision: 'new-revision' })).toBe('rejected');
    expect(await s.accept({ ...manifest(2), entityRevision: 'new-revision' })).toBe('accepted');
  });
  it.each([
    "UPDATE tenants SET enabled = 0 WHERE id = 'openings'",
    "UPDATE web_entity_manifests SET status = 'closed'", 'DELETE FROM web_entity_manifests',
    "UPDATE web_entity_manifests SET content_sha256 = 'changed'",
    "UPDATE artifacts SET tenant_id = 'other'", "UPDATE artifacts SET sha256 = 'changed'",
    'UPDATE artifacts SET byte_size = 11', "UPDATE artifacts SET media_type = 'image/jpeg'",
    "UPDATE artifacts SET storage = 'external'", "UPDATE artifacts SET state = 'staged'",
    "UPDATE artifacts SET tombstoned_at = 'now'", "UPDATE artifacts SET deleted_at = 'now'",
    'UPDATE artifact_references SET safe_to_delete = 1', 'DELETE FROM artifact_references',
    "UPDATE artifact_references SET tenant_id = 'other'", "UPDATE deliveries SET tenant_id = 'other'",
    "UPDATE deliveries SET state = 'failed_terminal'", "UPDATE deliveries SET adapter = 'social.shadow'",
    'UPDATE adapter_controls SET enabled = 0', 'DELETE FROM adapter_controls',
  ])('fails closed at read and atomic acceptance after %s', async (change) => {
    const s = store(); expect(await s.accept(manifest())).toBe('accepted');
    sqlite.exec(change);
    expect(await s.read('job')).toBeNull();
    expect(await s.accept(manifest(2))).toBe('rejected');
    expect(await s.accept(manifest())).toBe('rejected');
  });
  it('rejects missing artifact and invalid manifests without database work', async () => {
    expect(await store().accept({ ...manifest(), secret: 'sensitive' })).toBe('rejected');
    expect(queries).toEqual([]);
    sqlite.exec('DELETE FROM artifact_references; DELETE FROM artifacts');
    expect(await store().accept(manifest())).toBe('rejected');
  });
  it('copies adapter authority and denies empty/shadow-only allowlists without database work', async () => {
    const adapters = ['social.real']; const s = store(adapters); adapters.length = 0;
    expect(await s.accept(manifest())).toBe('accepted');
    queries = [];
    for (const denied of [[], ['social.shadow']]) {
      expect(await store(denied).accept(manifest())).toBe('rejected');
      expect(await store(denied).read('job')).toBeNull();
    }
    expect(queries).toEqual([]);
  });
  it('rechecks entity eligibility within the insertion, not before it', async () => {
    const s = createD1OpeningsBridgeStore(database((sql) => {
      if (sql.includes('INSERT INTO')) sqlite.exec("UPDATE web_entity_manifests SET status = 'closed'");
    }), ['social.real']);
    expect(await s.accept(manifest())).toBe('rejected');
  });
  it('rejects acceptance if entity eligibility changes before the confirming read', async () => {
    const s = createD1OpeningsBridgeStore(database((sql) => {
      if (sql.startsWith('SELECT b.*')) sqlite.exec("UPDATE web_entity_manifests SET revision = 'changed'");
    }), ['social.real']);
    expect(await s.accept(manifest())).toBe('rejected');
    expect(await s.read('job')).toBeNull();
  });
  it('uses fixed diagnostics without leaking database details', async () => {
    const s = createD1OpeningsBridgeStore(database(() => { throw new Error('private database data'); }), ['social.real']);
    await expect(s.accept(manifest())).rejects.toThrow(/^Openings bridge acceptance failed$/u);
    await expect(s.read('job')).rejects.toThrow(/^Openings bridge read failed$/u);
  });
  it.each(['ready', 'delivering', 'delivered', 'processing', 'retry_wait', 'reconciling'])(
    'accepts the public media resolver eligible delivery state %s', async (state) => {
      sqlite.prepare('UPDATE deliveries SET state = ?').run(state);
      expect(await store().accept(manifest())).toBe('accepted');
    });
  it('never falls back from an ineligible latest generation to an eligible old row', async () => {
    const s = store(); await s.accept(manifest());
    const next = manifest(2);
    if (next.media[0]) next.media[0].artifactId = 'artifact_87654321';
    sqlite.exec(`INSERT INTO artifacts SELECT 'artifact_87654321', tenant_id, storage, sha256, byte_size,
      media_type, 'temporary/openings/b', state, tombstoned_at, deleted_at, deletion_reason, created_at FROM artifacts;
      INSERT INTO artifact_references VALUES ('openings', 'artifact_87654321', 'd', 0, 'now')`);
    expect(await s.accept(next)).toBe('accepted');
    sqlite.exec("UPDATE artifacts SET state = 'deleted' WHERE id = 'artifact_87654321'");
    expect(await s.read('job')).toBeNull();
    expect(await s.accept(manifest())).toBe('rejected');
  });
  it.each(['unknown field', 'column mismatch', 'bad dimensions'])('rejects malformed persisted rows: %s', async (kind) => {
    const s = store(); await s.accept(manifest());
    if (kind === 'column mismatch') sqlite.exec("UPDATE openings_job_media_bridges SET entity_revision = 'wrong'");
    else {
      const bad = kind === 'unknown field' ? { ...manifest(), private: true }
        : { ...manifest(), media: [{ ...manifest().media[0], width: 0 }] };
      sqlite.prepare('UPDATE openings_job_media_bridges SET manifest_json = ?').run(JSON.stringify(bad));
    }
    expect(await s.read('job')).toBeNull();
  });
  it('returns null for a persisted primitive media entry', async () => {
    const s = store(); await s.accept(manifest());
    sqlite.prepare('UPDATE openings_job_media_bridges SET manifest_json = ?')
      .run(JSON.stringify({ ...manifest(), media: ['private malformed value'] }));
    expect(await s.read('job')).toBeNull();
  });
});
