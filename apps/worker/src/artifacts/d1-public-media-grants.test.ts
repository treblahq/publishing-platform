import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1PublicMediaResolver } from './d1-public-media-grants.js';
import { handlePublicMediaRequest } from './public-media.js';

const identity = { tenant: 'openings', artifactId: 'artifact_12345678', sha256: 'a'.repeat(64) };
const expected = { ...identity, locator: 'temporary/openings/card.png', byteSize: 10,
  mediaType: 'image/png', expiresAt: '2026-09-08T13:00:00.000Z' };
const now = () => new Date('2026-09-08T12:00:00Z');
let sqlite: DatabaseSync;
let reads: number;
let preparations: number;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  reads = 0;
  preparations = 0;
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('other', 'Other', 1), ('equity', 'Equity', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('producer', 'openings', 'pipeline', 1, 'test-hash');
    INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES ('publication', 'openings', 'producer', 'test', 'source', '1', 'key', '{}', 'accepted');
    INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('delivery', 'openings', 'publication', 'key', 'social.buffer', 'publish', 1, '{}', 'processing');
    INSERT INTO adapter_controls (tenant_id, adapter, enabled) VALUES ('openings', 'social.buffer', 1);`);
  sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
    VALUES (?, 'openings', 'r2-temporary', ?, 10, 'image/png', 'temporary/openings/card.png', 'available')`)
    .run(identity.artifactId, identity.sha256);
  sqlite.prepare(`INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
    VALUES ('openings', ?, 'delivery', 0)`).run(identity.artifactId);
  sqlite.prepare(`INSERT INTO public_media_grants (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at)
    VALUES ('openings', ?, 'delivery', ?, '2026-09-08T11:00:00Z', '2026-09-08T13:00:00Z')`)
    .run(identity.artifactId, identity.sha256);
});
afterEach(() => { sqlite.close(); });

function database() {
  return { prepare(sql: string) {
    preparations++;
    expect(sql.trim()).toMatch(/^SELECT\b/u);
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...inputs: unknown[]) { values = inputs as SQLInputValue[]; return statement; },
      first() { reads++; return Promise.resolve(sqlite.prepare(sql).get(...values) ?? null); },
    };
    return statement;
  } };
}

async function resolve(adapters: readonly string[] = ['social.buffer']) {
  const changes = sqlite.prepare('SELECT total_changes() AS changes').get();
  const result = await createD1PublicMediaResolver(database(), adapters, now)(identity);
  expect(reads).toBeLessThanOrEqual(1);
  expect(preparations).toBeLessThanOrEqual(1);
  expect(sqlite.prepare('SELECT total_changes() AS changes').get()).toEqual(changes);
  return result;
}

describe('durable public media approval resolution', () => {
  it('reads the exact approved live grant without changing retention', async () => {
    expect(await resolve()).toEqual(expected);
    expect(reads).toBe(1);
  });

  it('normalizes a Julian expiry before selecting the first eligible grant', async () => {
    sqlite.exec(`UPDATE public_media_grants SET expires_at = '2461292.041666667';
      INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('delivery2', 'openings', 'publication', 'key2', 'social.buffer', 'publish', 1, '{}', 'processing');
      INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
      SELECT 'openings', artifact_id, 'delivery2', 0 FROM public_media_grants;
      INSERT INTO public_media_grants (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at)
      SELECT 'openings', artifact_id, 'delivery2', sha256, '2026-09-08T11:00:00Z', '2026-09-08T14:00:00Z' FROM public_media_grants;`);
    expect(await resolve()).toEqual({ ...expected, expiresAt: '2026-09-08T13:00:00.000Z' });
  });

  it('uses the exact normalized expiry instant for the exclusive expiry boundary', async () => {
    sqlite.exec("UPDATE public_media_grants SET expires_at = '2461292.041666667'");
    const resolver = (instant: string) => createD1PublicMediaResolver(database(), ['social.buffer'], () => new Date(instant));
    expect(await resolver('2026-09-08T12:59:59.999Z')(identity))
      .toEqual({ ...expected, expiresAt: '2026-09-08T13:00:00.000Z' });
    expect(await resolver('2026-09-08T13:00:00.000Z')(identity)).toBeNull();
  });

  it.each([
    ['missing grant', 'DELETE FROM public_media_grants'],
    ['revoked grant', "UPDATE public_media_grants SET revoked_at = '2026-09-08T11:30:00Z'"],
    ['expired grant', "UPDATE public_media_grants SET expires_at = '2026-09-08T12:00:00Z'"],
    ['future approval', "UPDATE public_media_grants SET approved_at = '2026-09-08T12:01:00Z'"],
    ['wrong grant tenant', "UPDATE public_media_grants SET tenant_id = 'other'"],
    ['wrong grant hash', `UPDATE public_media_grants SET sha256 = '${'b'.repeat(64)}'`],
    ['missing reference', 'DELETE FROM artifact_references'],
    ['released reference', 'UPDATE artifact_references SET safe_to_delete = 1'],
    ['cross-tenant reference', "UPDATE artifact_references SET tenant_id = 'other'"],
    ['missing adapter control', 'DELETE FROM adapter_controls'],
    ['disabled adapter', 'UPDATE adapter_controls SET enabled = 0'],
    ['cross-tenant adapter', "UPDATE adapter_controls SET tenant_id = 'other'"],
    ['disabled tenant', "UPDATE tenants SET enabled = 0 WHERE id = 'openings'"],
    ['cross-tenant artifact', "UPDATE artifacts SET tenant_id = 'other'"],
    ['cross-tenant delivery', "UPDATE deliveries SET tenant_id = 'other'"],
    ['wrong artifact hash', `UPDATE artifacts SET sha256 = '${'b'.repeat(64)}'`],
    ['staged artifact', "UPDATE artifacts SET state = 'staged'"],
    ['tombstoned artifact', "UPDATE artifacts SET state = 'tombstoned'"],
    ['deleted artifact', "UPDATE artifacts SET state = 'deleted'"],
    ['tombstone timestamp', "UPDATE artifacts SET tombstoned_at = '2026-09-08T11:00:00Z'"],
    ['deleted timestamp', "UPDATE artifacts SET deleted_at = '2026-09-08T11:00:00Z'"],
    ['wrong storage', "UPDATE artifacts SET storage = 'external'"],
    ['unsupported MIME', "UPDATE artifacts SET media_type = 'text/html'"],
    ['wrong locator tenant', "UPDATE artifacts SET locator = 'temporary/other/card.png'"],
    ['traversal locator', "UPDATE artifacts SET locator = 'temporary/openings/../card.png'"],
    ['encoded locator', "UPDATE artifacts SET locator = 'temporary/openings/%2e.png'"],
    ['remote locator', "UPDATE artifacts SET locator = 'https://example.com/card.png'"],
    ['oversized media', 'UPDATE artifacts SET byte_size = 50000001'],
    ['fractional media size', 'UPDATE artifacts SET byte_size = 1.5'],
  ])('denies %s', async (_name, sql) => {
    sqlite.exec(sql);
    expect(await resolve()).toBeNull();
  });

  it.each(['ready', 'delivering', 'delivered', 'processing', 'retry_wait', 'reconciling'])(
    'allows retained provider state %s', async (state) => {
      sqlite.prepare('UPDATE deliveries SET state = ?').run(state);
      expect(await resolve()).toEqual(expected);
    },
  );

  it.each(['succeeded', 'failed_terminal', 'cancelled', 'superseded', 'queued', 'unknown'])(
    'denies delivery state %s', async (state) => {
      sqlite.prepare('UPDATE deliveries SET state = ?').run(state);
      expect(await resolve()).toBeNull();
    },
  );

  it.each(['image/png', 'image/jpeg', 'video/mp4'])('allows supported MIME %s', async (mediaType) => {
    sqlite.prepare('UPDATE artifacts SET media_type = ?').run(mediaType);
    expect(await resolve()).toEqual({ ...expected, mediaType });
  });

  it('copies the allowlist and binds caller strings as values', async () => {
    const adapters = ['social.buffer'];
    const resolver = createD1PublicMediaResolver(database(), adapters, now);
    adapters[0] = "social.buffer') OR 1=1 --";
    expect(await resolver(identity)).toEqual(expected);
    reads = 0;
    preparations = 0;
    expect(await resolve(adapters)).toBeNull();
  });

  it('denies excluded adapters', async () => { expect(await resolve(['another'])).toBeNull(); });

  it('never permits social.shadow even in the trusted list', async () => {
    sqlite.exec("UPDATE deliveries SET adapter = 'social.shadow'; UPDATE adapter_controls SET adapter = 'social.shadow'");
    expect(await resolve(['social.shadow'])).toBeNull();
  });

  it.each([
    { ...identity, tenant: 'equity' }, { ...identity, tenant: '../openings' },
    { ...identity, tenant: 'Openings' }, { ...identity, tenant: 'a'.repeat(65) },
    { ...identity, artifactId: 'short' }, { ...identity, artifactId: 'a'.repeat(129) },
    { ...identity, artifactId: 'artifact_1234567/' }, { ...identity, sha256: 'A'.repeat(64) },
    { ...identity, sha256: 'a'.repeat(63) }, { ...identity, tenant: null }, null,
  ])('rejects invalid identity without consulting D1: %j', async (input) => {
    expect(await createD1PublicMediaResolver(database(), ['social.buffer'], now)(input as typeof identity)).toBeNull();
    expect(reads).toBe(0);
    expect(preparations).toBe(0);
  });

  it('does no database work for an empty allowlist or invalid clock', async () => {
    expect(await resolve([])).toBeNull();
    expect(await createD1PublicMediaResolver(database(), ['social.buffer'], () => new Date(NaN))(identity)).toBeNull();
    expect(reads).toBe(0);
    expect(preparations).toBe(0);
  });

  it.each([
    ["UPDATE public_media_grants SET expires_at = '2026-09-08T12:00:00Z'"],
    ['UPDATE artifact_references SET safe_to_delete = 1'],
    ["UPDATE deliveries SET adapter = 'disabled'; INSERT INTO adapter_controls (tenant_id, adapter, enabled) VALUES ('openings', 'disabled', 0)"],
    ["UPDATE deliveries SET tenant_id = 'other'"],
  ])('an ineligible first grant does not hide another eligible delivery: %s', async (sql) => {
    sqlite.exec(sql);
    sqlite.exec(`INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('delivery2', 'openings', 'publication', 'key2', 'social.buffer', 'publish', 1, '{}', 'processing');
      INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
      SELECT 'openings', artifact_id, 'delivery2', 0 FROM public_media_grants;
      INSERT INTO public_media_grants (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at)
      SELECT 'openings', artifact_id, 'delivery2', sha256, '2026-09-08T11:00:00Z', '2026-09-08T13:00:00Z' FROM public_media_grants;`);
    expect(await resolve(['social.buffer', 'disabled'])).toEqual(expected);
  });

  it.each([
    null, {}, { ...expected, tenant: 'other' }, { ...expected, artifactId: 'other' },
    { ...expected, sha256: 'b'.repeat(64) }, { ...expected, locator: null },
    { ...expected, byteSize: '10' }, { ...expected, byteSize: 0 },
    { ...expected, byteSize: NaN }, { ...expected, byteSize: Infinity },
    { ...expected, mediaType: null }, { ...expected, expiresAt: 42 },
    { ...expected, expiresAt: 'invalid' }, { ...expected, expiresAt: '2026-09-08T12:00:00Z' },
    { ...expected, locator: `temporary/openings/${'a'.repeat(900)}` },
  ])('fails closed on a malformed D1 result: %j', async (row) => {
    const db = { prepare: () => ({ bind: () => ({ first: () => Promise.resolve(row) }) }) };
    expect(await createD1PublicMediaResolver(db, ['social.buffer'], now)(identity)).toBeNull();
  });

  it.each([
    "UPDATE public_media_grants SET sha256 = 'ABC'",
    `UPDATE public_media_grants SET sha256 = '${'A'.repeat(64)}'`,
    "UPDATE public_media_grants SET approved_at = 'invalid'",
    "UPDATE public_media_grants SET expires_at = 'invalid'",
    "UPDATE public_media_grants SET expires_at = approved_at",
    "UPDATE public_media_grants SET expires_at = '2026-09-08T10:00:00Z'",
  ])('migration rejects invalid approval data: %s', (sql) => {
    expect(() => { sqlite.exec(sql); }).toThrow();
  });

  it('integrates with isolated transport and maps D1 failure to 503', async () => {
    const object = { size: 10, httpMetadata: { contentType: 'image/png' },
      customMetadata: { tenant: identity.tenant, sha256: identity.sha256, mediaType: 'image/png' },
      checksums: { sha256: new Uint8Array(32).fill(170).buffer } };
    const request = new Request(`https://media.example/media/${identity.tenant}/${identity.artifactId}/${identity.sha256}`, { method: 'HEAD' });
    let bucketReads = 0;
    const dependencies = { enabled: true, now, admit: () => Promise.resolve(true),
      resolve: createD1PublicMediaResolver(database(), ['social.buffer'], now),
      bucket: { head: () => { bucketReads++; return Promise.resolve(object); }, get: () => Promise.resolve(null) } };
    expect((await handlePublicMediaRequest(request, dependencies)).status).toBe(200);
    const broken = { prepare: () => { throw new Error('D1 unavailable'); } };
    dependencies.resolve = createD1PublicMediaResolver(broken, ['social.buffer'], now);
    await expect(dependencies.resolve(identity)).rejects.toThrow('D1 unavailable');
    expect((await handlePublicMediaRequest(request, dependencies)).status).toBe(503);
    expect(bucketReads).toBe(1);
  });
});
