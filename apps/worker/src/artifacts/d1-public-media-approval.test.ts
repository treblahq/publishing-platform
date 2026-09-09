import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1PublicMediaApprovalStore } from './d1-public-media-approval.js';
import { createD1PublicMediaResolver } from './d1-public-media-grants.js';
import { runD1ArtifactCleanup } from '../cleanup/d1-cleanup.js';

const input = { tenant: 'openings', artifactId: 'artifact_12345678', sha256: 'a'.repeat(64),
  deliveryId: 'delivery', fencingToken: 7, expiresAt: '2026-09-09T13:00:00.000Z' };
const now = () => new Date('2026-09-09T12:00:00.000Z');
let sqlite: DatabaseSync;
let statements: string[];

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  statements = [];
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('other', 'Other', 1), ('equity', 'Equity', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('producer', 'openings', 'pipeline', 1, 'test-hash');
    INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES ('publication', 'openings', 'producer', 'test', 'source', '1', 'key', '{}', 'accepted');
    INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state, lease_token, lease_expires_at)
      VALUES ('delivery', 'openings', 'publication', 'key', 'social.buffer', 'publish', 1, '{}', 'processing', 7, '2026-09-09T12:05:00.000Z');
    INSERT INTO adapter_controls (tenant_id, adapter, enabled) VALUES ('openings', 'social.buffer', 1);`);
  sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
    VALUES (?, 'openings', 'r2-temporary', ?, 10, 'image/png', 'temporary/openings/card.png', 'available')`).run(input.artifactId, input.sha256);
  sqlite.prepare(`INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
    VALUES ('openings', ?, 'delivery', 0)`).run(input.artifactId);
});
afterEach(() => { sqlite.close(); });

function database(beforeRun: (sql: string) => Promise<void> = () => Promise.resolve()) {
  return { prepare(sql: string) {
    statements.push(sql);
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...inputs: unknown[]) { values = inputs as SQLInputValue[]; return statement; },
      first: () => Promise.resolve(sqlite.prepare(sql).get(...values) ?? null),
      all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...values) }),
      run: async () => {
        await beforeRun(sql);
        return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
      },
    };
    return statement;
  } };
}

function grants() { return sqlite.prepare('SELECT * FROM public_media_grants').all(); }
function retainedState() {
  return ['artifacts', 'artifact_references', 'deliveries', 'receipts', 'publications']
    .map((table) => sqlite.prepare(`SELECT * FROM ${table}`).all());
}
function store(adapters: readonly string[] = ['social.buffer'], clock = now) {
  return createD1PublicMediaApprovalStore(database(), adapters, clock);
}

describe('fenced internal public media approval', () => {
  it('atomically creates the exact approval without changing retention or the delivery lease', async () => {
    const retained = retainedState();
    expect(await store().approve(input)).toBe('accepted');
    expect(grants()).toEqual([{ tenant_id: input.tenant, artifact_id: input.artifactId, delivery_id: input.deliveryId,
      sha256: input.sha256, approved_at: now().toISOString(), expires_at: input.expiresAt, revoked_at: null }]);
    expect(retainedState()).toEqual(retained);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^INSERT INTO public_media_grants/u);
  });

  it('replays exactly without extending approval and rejects a conflicting expiry', async () => {
    expect(await store().approve(input)).toBe('accepted');
    const before = grants();
    statements = [];
    expect(await store(['social.buffer'], () => new Date('2026-09-09T12:01:00Z')).approve(input)).toBe('replayed');
    expect(grants()).toEqual(before);
    expect(statements).toHaveLength(2);
    expect(statements[1]).toMatch(/^SELECT\b/u);
    expect(await store().approve({ ...input, expiresAt: '2026-09-09T14:00:00.000Z' })).toBe('rejected');
    expect(grants()).toEqual(before);
  });

  const ineligible = [
    ['released reference', 'UPDATE artifact_references SET safe_to_delete = 1'],
    ['missing reference', 'DELETE FROM artifact_references'],
    ['wrong reference tenant', "UPDATE artifact_references SET tenant_id = 'other'"],
    ['wrong artifact tenant', "UPDATE artifacts SET tenant_id = 'other'"],
    ['wrong delivery tenant', "UPDATE deliveries SET tenant_id = 'other'"],
    ['disabled tenant', "UPDATE tenants SET enabled = 0 WHERE id = 'openings'"],
    ['missing adapter control', 'DELETE FROM adapter_controls'],
    ['disabled adapter', 'UPDATE adapter_controls SET enabled = 0'],
    ['wrong control tenant', "UPDATE adapter_controls SET tenant_id = 'other'"],
    ['different adapter', "UPDATE deliveries SET adapter = 'other'"],
    ['shadow', "UPDATE deliveries SET adapter = 'social.shadow'; UPDATE adapter_controls SET adapter = 'social.shadow'"],
    ['different hash', `UPDATE artifacts SET sha256 = '${'b'.repeat(64)}'`],
    ['staged artifact', "UPDATE artifacts SET state = 'staged'"],
    ['tombstoned artifact', "UPDATE artifacts SET state = 'tombstoned'"],
    ['deleted artifact', "UPDATE artifacts SET state = 'deleted'"],
    ['tombstone timestamp', "UPDATE artifacts SET tombstoned_at = '2026-09-09T11:00:00Z'"],
    ['deleted timestamp', "UPDATE artifacts SET deleted_at = '2026-09-09T11:00:00Z'"],
    ['external storage', "UPDATE artifacts SET storage = 'external'"],
    ['unsupported MIME', "UPDATE artifacts SET media_type = 'text/html'"],
    ['fractional size', 'UPDATE artifacts SET byte_size = 1.5'],
    ['oversized', 'UPDATE artifacts SET byte_size = 50000001'],
    ['wrong locator tenant', "UPDATE artifacts SET locator = 'temporary/other/card.png'"],
    ['traversal locator', "UPDATE artifacts SET locator = 'temporary/openings/../card.png'"],
    ['encoded locator', "UPDATE artifacts SET locator = 'temporary/openings/%2e.png'"],
    ['remote locator', "UPDATE artifacts SET locator = 'https://example.com/card.png'"],
    ['oversized locator', `UPDATE artifacts SET locator = 'temporary/openings/${'a'.repeat(900)}'`],
    ['stale token', 'UPDATE deliveries SET lease_token = 8'],
    ['missing lease', 'UPDATE deliveries SET lease_expires_at = NULL'],
    ['invalid lease', "UPDATE deliveries SET lease_expires_at = 'invalid'"],
    ['expired lease', "UPDATE deliveries SET lease_expires_at = '2026-09-09T11:59:59.999Z'"],
    ['exact lease boundary', "UPDATE deliveries SET lease_expires_at = '2026-09-09T12:00:00.000Z'"],
    ...['ready', 'queued', 'retry_wait', 'delivered', 'succeeded', 'needs_attention', 'failed_terminal', 'cancelled', 'unknown']
      .map((state) => [`delivery ${state}`, `UPDATE deliveries SET state = '${state}'`]),
  ];

  it.each(ineligible)('rejects %s for new issuance and replay', async (_name, sql) => {
    expect(await store().approve(input)).toBe('accepted');
    const before = grants();
    sqlite.exec(sql);
    const retained = retainedState();
    expect(await store(['social.buffer', 'social.shadow']).approve(input)).toBe('rejected');
    expect(grants()).toEqual(before);
    sqlite.exec('DELETE FROM public_media_grants');
    expect(await store(['social.buffer', 'social.shadow']).approve(input)).toBe('rejected');
    expect(grants()).toEqual([]);
    expect(retainedState()).toEqual(retained);
  });

  it.each(['delivering', 'processing', 'reconciling'])('allows a live %s delivery', async (state) => {
    sqlite.prepare('UPDATE deliveries SET state = ?').run(state);
    expect(await store().approve(input)).toBe('accepted');
  });

  it.each(['image/png', 'image/jpeg', 'video/mp4'])('allows %s media', async (mime) => {
    sqlite.prepare('UPDATE artifacts SET media_type = ?').run(mime);
    expect(await store().approve(input)).toBe('accepted');
  });

  it.each([
    { ...input, tenant: 'equity' }, { ...input, tenant: 'Openings' }, { ...input, tenant: '../openings' },
    { ...input, tenant: `${input.tenant}\n` }, { ...input, tenant: 'a'.repeat(65) },
    { ...input, artifactId: 'short' }, { ...input, artifactId: 'a'.repeat(129) },
    { ...input, artifactId: `${input.artifactId}\n` }, { ...input, sha256: 'A'.repeat(64) },
    { ...input, sha256: `${input.sha256}\n` }, { ...input, deliveryId: '' },
    { ...input, deliveryId: 'a'.repeat(129) }, { ...input, deliveryId: 'delivery/one' },
    { ...input, deliveryId: 'delivery\n' }, { ...input, fencingToken: 0 }, { ...input, fencingToken: -1 },
    { ...input, tenant: 'openings\r' }, { ...input, artifactId: `${input.artifactId}\u2028` },
    { ...input, deliveryId: 'delivery\u2029' },
    { ...input, fencingToken: 1.5 }, { ...input, fencingToken: NaN }, { ...input, fencingToken: Infinity },
    { ...input, fencingToken: Number.MAX_SAFE_INTEGER + 1 }, { ...input, fencingToken: '7' },
    { ...input, expiresAt: '2026-09-09T13:00:00Z' }, { ...input, expiresAt: '2026-09-09T13:00:00.000+00:00' },
    { ...input, expiresAt: '2026-09-09T12:00:00.000Z' }, { ...input, expiresAt: '2026-09-09T11:59:59.999Z' },
    { ...input, expiresAt: '2026-09-16T12:00:00.001Z' }, { ...input, expiresAt: 'invalid' },
    { ...input, extra: true }, { ...input, sha256: null }, {}, null, undefined,
  ])('rejects malformed input before SQL: %j', async (value) => {
    expect(await store().approve(value as typeof input)).toBe('rejected');
    expect(statements).toHaveLength(0);
  });

  it('permits exactly seven days and captures the clock once', async () => {
    let calls = 0;
    const clock = () => { calls++; return now(); };
    expect(await store(['social.buffer'], clock).approve({ ...input, expiresAt: '2026-09-16T12:00:00.000Z' })).toBe('accepted');
    expect(calls).toBe(1);
  });

  it.each([() => new Date(NaN), () => null, () => { throw new Error('clock'); }])('rejects invalid clocks without SQL', async (clock) => {
    expect(await store(['social.buffer'], clock as () => Date).approve(input)).toBe('rejected');
    expect(statements).toHaveLength(0);
  });

  it('copies its allowlist and rejects empty or shadow-only allowlists before SQL', async () => {
    const adapters = ['social.buffer', 'social.buffer'];
    const approvals = store(adapters);
    adapters[0] = 'other';
    adapters[1] = 'other';
    expect(await approvals.approve(input)).toBe('accepted');
    statements = [];
    expect(await store([]).approve(input)).toBe('rejected');
    expect(await store(['social.shadow']).approve(input)).toBe('rejected');
    expect(statements).toHaveLength(0);
  });

  it.each([
    "revoked_at = '2026-09-09T12:00:00.000Z'",
    "approved_at = '2026-09-09T12:01:00.000Z'",
    "approved_at = '2026-09-09T10:00:00.000Z', expires_at = '2026-09-09T12:00:00.000Z'",
  ])('does not resurrect a noncurrent approval: %s', async (assignment) => {
    expect(await store().approve(input)).toBe('accepted');
    sqlite.exec(`UPDATE public_media_grants SET ${assignment}`);
    const before = grants();
    expect(await store().approve(input)).toBe('rejected');
    expect(grants()).toEqual(before);
  });

  it('hides database diagnostics without retrying', async () => {
    let calls = 0;
    const db = { prepare: () => { calls++; throw new Error('secret database detail'); } };
    await expect(createD1PublicMediaApprovalStore(db, ['social.buffer'], now).approve(input))
      .rejects.toThrow('Public media approval failed');
    expect(calls).toBe(1);
  });

  it('does not treat a malformed INSERT result as permission to fall back to replay', async () => {
    let calls = 0;
    const db = { prepare: () => ({ bind: () => ({ first: () => {
      calls++;
      return Promise.resolve(calls === 1 ? {} : { eligible: 1 });
    } }) }) };
    await expect(createD1PublicMediaApprovalStore(db, ['social.buffer'], now).approve(input))
      .rejects.toThrow('Public media approval failed');
    expect(calls).toBe(1);
  });

  it('allows one concurrent insertion and only immutable exact replays', async () => {
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => store().approve(input)));
    expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'replayed')).toHaveLength(9);
    expect(grants()).toHaveLength(1);
  });

  it('does not replay another delivery grant when the caller mutates input during INSERT', async () => {
    expect(await store().approve(input)).toBe('accepted');
    sqlite.exec(`INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES ('other-delivery', 'openings', 'publication', 'other-key', 'social.buffer', 'publish', 1, '{}', 'succeeded');
      INSERT INTO public_media_grants (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at)
      SELECT tenant_id, artifact_id, 'other-delivery', sha256, approved_at, expires_at FROM public_media_grants`);
    const mutable = { ...input, expiresAt: '2026-09-09T14:00:00.000Z' };
    const actual = database();
    const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ first: async () => {
      const result = await actual.prepare(sql).bind(...values).first();
      if (sql.startsWith('INSERT')) Object.assign(mutable, { deliveryId: 'other-delivery', expiresAt: input.expiresAt });
      return result;
    } }) }) };
    const before = grants();
    expect(await createD1PublicMediaApprovalStore(db, ['social.buffer'], now).approve(mutable)).toBe('rejected');
    expect(grants()).toEqual(before);
  });

  it('replays the captured original input despite mutation of every caller field during INSERT', async () => {
    expect(await store().approve(input)).toBe('accepted');
    const mutable = { ...input };
    const actual = database();
    const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ first: async () => {
      const result = await actual.prepare(sql).bind(...values).first();
      if (sql.startsWith('INSERT')) Object.assign(mutable, { tenant: 'other', artifactId: 'artifact_87654321',
        sha256: 'b'.repeat(64), deliveryId: 'other-delivery', fencingToken: 8, expiresAt: '2026-09-09T14:00:00.000Z' });
      return result;
    } }) }) };
    const before = grants();
    expect(await createD1PublicMediaApprovalStore(db, ['social.buffer'], now).approve(mutable)).toBe('replayed');
    expect(grants()).toEqual(before);
  });

  it('replays a lost INSERT response on a fresh retry without extending timestamps', async () => {
    const actual = database();
    const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ first: async () => {
      await actual.prepare(sql).bind(...values).first();
      throw new Error('response lost after commit');
    } }) }) };
    await expect(createD1PublicMediaApprovalStore(db, ['social.buffer'], now).approve(input))
      .rejects.toThrow('Public media approval failed');
    expect(statements).toHaveLength(1);
    const before = grants();
    expect(before).toHaveLength(1);
    expect(await store(['social.buffer'], () => new Date('2026-09-09T12:01:00Z')).approve(input)).toBe('replayed');
    expect(grants()).toEqual(before);
  });

  it('lets the real resolver serve approval until its unsafe reference is released', async () => {
    expect(await store().approve(input)).toBe('accepted');
    const resolve = createD1PublicMediaResolver(database(), ['social.buffer'], now);
    expect(await resolve(input)).toMatchObject({ tenant: input.tenant, artifactId: input.artifactId, sha256: input.sha256,
      expiresAt: input.expiresAt });
    const before = grants();
    sqlite.exec('UPDATE artifact_references SET safe_to_delete = 1');
    expect(await resolve(input)).toBeNull();
    expect(await store().approve(input)).toBe('rejected');
    expect(grants()).toEqual(before);
  });

  it('approval before cleanup claim prevents deletion even after delivery becomes terminal', async () => {
    sqlite.exec("UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z'; UPDATE deliveries SET state = 'needs_attention'");
    let deletes = 0;
    const db = database(async (sql) => {
      if (!sql.includes("SET state = 'tombstoned'")) return;
      sqlite.exec("UPDATE deliveries SET state = 'processing'");
      expect(await store().approve(input)).toBe('accepted');
      sqlite.exec("UPDATE deliveries SET state = 'needs_attention'");
    });
    expect(await runD1ArtifactCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
    expect(sqlite.prepare('SELECT state FROM artifacts').get()).toEqual({ state: 'available' });
    expect(await runD1ArtifactCleanup(database(), { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
  });

  it.each([false, true])('tombstone before approval prevents insertion, bucket failure=%s', async (fails) => {
    sqlite.exec("UPDATE artifacts SET created_at = '2000-01-01T00:00:00.000Z'; UPDATE deliveries SET state = 'needs_attention'");
    const bucket = { delete: async () => {
      sqlite.exec("UPDATE deliveries SET state = 'processing'");
      expect(await store().approve(input)).toBe('rejected');
      if (fails) throw new Error('bucket unavailable');
    } };
    if (fails) await expect(runD1ArtifactCleanup(database(), bucket, 10)).rejects.toThrow('bucket unavailable');
    else expect(await runD1ArtifactCleanup(database(), bucket, 10)).toBe(1);
    expect(await store().approve(input)).toBe('rejected');
    expect(grants()).toEqual([]);
    expect(sqlite.prepare('SELECT state FROM artifacts').get()).toEqual({ state: fails ? 'tombstoned' : 'deleted' });
  });
});
