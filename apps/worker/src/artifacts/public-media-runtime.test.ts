import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorker } from '../index.js';
import { createD1PublicMediaApprovalStore } from './d1-public-media-approval.js';
import type { MediaRange } from './public-media.js';

const identity = { tenant: 'openings', artifactId: 'artifact_12345678', sha256: 'a'.repeat(64) };
const accountId = 'a'.repeat(32);
const instant = Date.parse('2026-09-09T12:00:00.000Z');
const config = { enabled: true, accountId, allowedAdapters: ['social.buffer'], cost: { d1Reads: 2, d1Writes: 1, r2ClassB: 2 } };
const path = `/media/${identity.tenant}/${identity.artifactId}/${identity.sha256}`;
let sqlite: DatabaseSync;
let statements: string[];
let heads: string[];
let gets: { key: string; options: { range: MediaRange } | undefined }[];
let mediaType: string;

function database() {
  return { prepare(sql: string) {
    statements.push(sql);
    return { bind(...values: unknown[]) {
      return {
        first: () => Promise.resolve(sqlite.prepare(sql).get(...values as SQLInputValue[]) ?? null),
        run: () => Promise.resolve({ success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values as SQLInputValue[]).changes) } }),
      };
    } };
  } };
}

function object() {
  return { size: 10, httpMetadata: { contentType: mediaType },
    customMetadata: { tenant: identity.tenant, sha256: identity.sha256, mediaType },
    checksums: { sha256: new Uint8Array(32).fill(170).buffer } };
}

function bucket() {
  return {
    head(key: string) { heads.push(key); return Promise.resolve(object()); },
    get(key: string, options?: { range: MediaRange }) {
      gets.push({ key, options });
      const text = options ? '0123456789'.slice(options.range.offset, options.range.offset + options.range.length) : '0123456789';
      const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
      return Promise.resolve({ ...object(), body, ...(options ? { range: options.range } : {}) });
    },
  };
}

function environment(): Record<string, unknown> {
  return { PUBLIC_MEDIA_GATEWAY_CONFIG: JSON.stringify(config), LEDGER: database(), ARTIFACTS: bucket() };
}

function fetchMedia(env = environment(), method = 'GET', pathname = path, headers?: HeadersInit) {
  return createWorker().fetch(new Request(`https://media.example${pathname}`, {
    method, ...(headers === undefined ? {} : { headers }),
  }), env);
}

function reserved() {
  return sqlite.prepare('SELECT d1_reads_reserved, d1_writes_reserved, r2_class_b_reserved FROM public_media_admission_allocations').get();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  sqlite = new DatabaseSync(':memory:');
  statements = [];
  heads = [];
  gets = [];
  mediaType = 'image/png';
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('other', 'Other', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('producer', 'openings', 'pipeline', 1, 'test-hash');
    INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES ('publication', 'openings', 'producer', 'test', 'source', '1', 'key', '{}', 'accepted');
    INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state, lease_token, lease_expires_at)
      VALUES ('delivery', 'openings', 'publication', 'key', 'social.buffer', 'publish', 1, '{}', 'processing', 7, '2026-09-09T12:05:00.000Z');
    INSERT INTO adapter_controls (tenant_id, adapter, enabled) VALUES ('openings', 'social.buffer', 1);`);
  sqlite.prepare(`INSERT INTO artifacts (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
    VALUES (?, 'openings', 'r2-temporary', ?, 10, 'image/png', 'temporary/openings/card.png', 'available')`).run(identity.artifactId, identity.sha256);
  sqlite.prepare(`INSERT INTO artifact_references (tenant_id, artifact_id, delivery_id, safe_to_delete)
    VALUES ('openings', ?, 'delivery', 0)`).run(identity.artifactId);
  sqlite.prepare(`INSERT INTO public_media_admission_allocations
    (account_id, enabled, measured_at_ms, expires_at_ms, d1_reads_limit, d1_reads_reserved,
      d1_writes_limit, d1_writes_reserved, r2_class_b_limit, r2_class_b_reserved)
    VALUES (?, 1, ?, ?, 20, 0, 10, 0, 20, 0)`).run(accountId, instant, instant + 900_000);
  expect(await createD1PublicMediaApprovalStore(database(), ['social.buffer'], () => new Date()).approve({
    ...identity, deliveryId: 'delivery', fencingToken: 7, expiresAt: '2026-09-09T13:00:00.000Z',
  })).toBe('accepted');
  statements = [];
});
afterEach(() => { sqlite.close(); vi.useRealTimers(); });

describe('public media through the actual Worker router', () => {
  it('serves an approved PNG GET using only ledger and native bucket bindings', async () => {
    const response = await fetchMedia();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('0123456789');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(gets).toEqual([{ key: 'temporary/openings/card.png', options: undefined }]);
    expect(heads).toEqual([]);
    expect(reserved()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
    expect(statements).toHaveLength(2);
  });

  async function expectDenial(response: Response, status: number) {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  }

  function expectNoIO() {
    expect(statements).toEqual([]);
    expect(heads).toEqual([]);
    expect(gets).toEqual([]);
  }

  it('uses metadata-only native HEAD and never gets the object body', async () => {
    const response = await fetchMedia(environment(), 'HEAD');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('content-length')).toBe('10');
    expect(heads).toEqual(['temporary/openings/card.png']);
    expect(gets).toEqual([]);
  });

  it('maps MP4 byte ranges to the native R2 options shape', async () => {
    mediaType = 'video/mp4';
    sqlite.exec("UPDATE artifacts SET media_type = 'video/mp4'");
    const response = await fetchMedia(environment(), 'GET', path, { range: 'bytes=2-5' });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('2345');
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(heads).toEqual(['temporary/openings/card.png']);
    expect(gets).toEqual([{ key: 'temporary/openings/card.png', options: { range: { offset: 2, length: 4 } } }]);
  });

  it('accepts the exact configuration size and adapter count bounds', async () => {
    const allowedAdapters = ['social.buffer', `social.${'a'.repeat(64)}`,
      ...Array.from({ length: 14 }, (_, index) => `social.adapter${String(index)}`)];
    const encoded = JSON.stringify({ ...config, allowedAdapters });
    const response = await fetchMedia({ ...environment(), PUBLIC_MEDIA_GATEWAY_CONFIG: encoded.padEnd(4096, ' ') });
    expect(response.status).toBe(200);
  });

  it('reserves the configured cost vector rather than substituting minimum costs', async () => {
    const response = await fetchMedia({ ...environment(), PUBLIC_MEDIA_GATEWAY_CONFIG: JSON.stringify({
      ...config, cost: { d1Reads: 7, d1Writes: 3, r2ClassB: 5 },
    }) });
    expect(response.status).toBe(200);
    expect(reserved()).toEqual({ d1_reads_reserved: 7, d1_writes_reserved: 3, r2_class_b_reserved: 5 });
  });

  it.each([undefined, JSON.stringify({ enabled: false }), JSON.stringify({ ...config, enabled: false })])(
    'keeps missing or disabled configuration dark without any bindings: %j', async (value) => {
      await expectDenial(await fetchMedia({ PUBLIC_MEDIA_GATEWAY_CONFIG: value }), 404);
      expectNoIO();
    },
  );

  it.each([
    null, '', '{', 'null', '[]', 'true', 1, JSON.stringify({}),
    JSON.stringify({ ...config, enabled: 'true' }), JSON.stringify({ ...config, enabled: 1 }),
    JSON.stringify({ ...config, extra: true }), JSON.stringify({ ...config, accountId: undefined }),
    JSON.stringify({ ...config, accountId: 'A'.repeat(32) }), JSON.stringify({ ...config, accountId: 'a'.repeat(31) }),
    JSON.stringify({ ...config, accountId: `${accountId}\n` }), JSON.stringify({ ...config, accountId: 'g'.repeat(32) }),
    JSON.stringify({ ...config, allowedAdapters: [] }), JSON.stringify({ ...config, allowedAdapters: 'social.buffer' }),
    JSON.stringify({ ...config, allowedAdapters: ['social.buffer', 'social.buffer'] }),
    JSON.stringify({ ...config, allowedAdapters: ['social.shadow'] }),
    JSON.stringify({ ...config, allowedAdapters: ['web.r2'] }), JSON.stringify({ ...config, allowedAdapters: ['social.'] }),
    JSON.stringify({ ...config, allowedAdapters: ['social.Buffer'] }),
    JSON.stringify({ ...config, allowedAdapters: ['social.buffer\n'] }),
    JSON.stringify({ ...config, allowedAdapters: [`social.${'a'.repeat(65)}`] }),
    JSON.stringify({ ...config, allowedAdapters: Array.from({ length: 17 }, (_, i) => `social.adapter${String(i)}`) }),
    JSON.stringify({ ...config, cost: null }), JSON.stringify({ ...config, cost: [] }),
    JSON.stringify({ ...config, cost: { ...config.cost, extra: 1 } }),
    JSON.stringify({ ...config, cost: { ...config.cost, d1Reads: undefined } }),
    ...(['d1Reads', 'd1Writes', 'r2ClassB'] as const).flatMap((dimension) =>
      [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1, config.cost[dimension] - 1]
        .map((value) => JSON.stringify({ ...config, cost: { ...config.cost, [dimension]: value } }))),
    `${JSON.stringify(config)}${' '.repeat(4097)}`,
  ])('rejects malformed enabled config before all I/O: %j', async (value) => {
    await expectDenial(await fetchMedia({ ...environment(), PUBLIC_MEDIA_GATEWAY_CONFIG: value }), 503);
    expectNoIO();
  });

  it.each([
    { LEDGER: undefined }, { LEDGER: {} }, { LEDGER: { prepare: true } },
    { ARTIFACTS: undefined }, { ARTIFACTS: {} }, { ARTIFACTS: { head: true, get: () => Promise.resolve(null) } },
    { ARTIFACTS: { head: () => Promise.resolve(null), get: false } },
  ])('rejects missing or malformed native methods before I/O: %j', async (change) => {
    await expectDenial(await fetchMedia({ ...environment(), ...change }), 503);
    expectNoIO();
  });

  it.each([
    ['POST', path], ['DELETE', path], ['GET', '/media'], ['GET', '/media/'], ['GET', '/media/bad'],
    ['GET', `${path}?token=not-allowed`], ['GET', path.replace('/openings/', '/equity/')],
    ['GET', path.replace(identity.sha256, 'A'.repeat(64))], ['GET', `${path}/extra`],
  ])('denies unsupported transport request %s %s before admission', async (method, pathname) => {
    await expectDenial(await fetchMedia(environment(), method, pathname), 404);
    expectNoIO();
  });

  it.each([
    'DELETE FROM public_media_admission_allocations',
    'UPDATE public_media_admission_allocations SET enabled = 0',
    'UPDATE public_media_admission_allocations SET d1_reads_reserved = d1_reads_limit',
    'UPDATE public_media_admission_allocations SET d1_writes_reserved = d1_writes_limit',
    'UPDATE public_media_admission_allocations SET r2_class_b_reserved = r2_class_b_limit',
  ])('denies missing or exhausted admission without reaching resolver or R2: %s', async (sql) => {
    sqlite.exec(sql);
    await expectDenial(await fetchMedia(), 503);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^UPDATE public_media_admission_allocations/u);
    expect(heads).toEqual([]);
    expect(gets).toEqual([]);
  });

  it.each([
    'DELETE FROM public_media_grants', 'UPDATE artifact_references SET safe_to_delete = 1',
    "UPDATE public_media_grants SET revoked_at = '2026-09-09T12:00:00.000Z'",
    "UPDATE artifacts SET tenant_id = 'other'", "UPDATE deliveries SET tenant_id = 'other'",
    "UPDATE public_media_grants SET tenant_id = 'other'", 'UPDATE adapter_controls SET enabled = 0',
  ])('denies grant ineligibility after reserving, without a bucket request: %s', async (sql) => {
    sqlite.exec(sql);
    await expectDenial(await fetchMedia(), 404);
    expect(statements).toHaveLength(2);
    expect(heads).toEqual([]);
    expect(gets).toEqual([]);
    expect(reserved()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
  });

  it('does not expose a grant through another tenant path', async () => {
    await expectDenial(await fetchMedia(environment(), 'GET', path.replace('/openings/', '/other/')), 404);
    expect(heads).toEqual([]);
    expect(gets).toEqual([]);
  });

  it.each(['metadata', 'checksum', 'size'])('rejects mismatched R2 %s and cancels its body without refund', async (mismatch) => {
    let cancelled = false;
    const env = environment();
    env.ARTIFACTS = { head: () => Promise.resolve(object()), get: () => Promise.resolve({ ...object(),
      ...(mismatch === 'metadata' ? { customMetadata: { tenant: 'other' } } : {}),
      ...(mismatch === 'checksum' ? { checksums: { sha256: new Uint8Array(32).fill(187).buffer } } : {}),
      ...(mismatch === 'size' ? { size: 11 } : {}),
      body: new ReadableStream({ cancel() { cancelled = true; } }),
    }) };
    await expectDenial(await fetchMedia(env), 404);
    expect(cancelled).toBe(true);
    expect(reserved()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
  });

  it.each(['admission', 'resolver', 'head', 'get'])('conceals %s upstream errors behind an empty 503', async (stage) => {
    const env = environment();
    const actual = database();
    env.LEDGER = { prepare: (sql: string) => {
      if ((stage === 'admission' && sql.startsWith('UPDATE')) || (stage === 'resolver' && sql.startsWith('SELECT'))) {
        statements.push(sql);
        throw new Error('secret config and temporary/openings/private.png');
      }
      return actual.prepare(sql);
    } };
    const native = bucket();
    env.ARTIFACTS = {
      head: (key: string) => stage === 'head' ? Promise.reject(new Error('private head diagnostic')) : native.head(key),
      get: (key: string) => stage === 'get' ? Promise.reject(new Error('private get diagnostic')) : native.get(key),
    };
    await expectDenial(await fetchMedia(env, stage === 'head' ? 'HEAD' : 'GET'), 503);
    expect(statements).toHaveLength(stage === 'admission' ? 1 : 2);
    expect(reserved()).toEqual({ d1_reads_reserved: stage === 'admission' ? 0 : 2,
      d1_writes_reserved: stage === 'admission' ? 0 : 1, r2_class_b_reserved: stage === 'admission' ? 0 : 2 });
  });

  it('shares the finite budget across fresh Worker callers without oversubscription', async () => {
    sqlite.exec('UPDATE public_media_admission_allocations SET d1_reads_limit = 4, d1_writes_limit = 2, r2_class_b_limit = 4');
    const responses = await Promise.all(Array.from({ length: 12 }, () => fetchMedia()));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 503)).toHaveLength(10);
    expect(gets).toHaveLength(2);
    expect(statements.filter((sql) => sql.startsWith('SELECT'))).toHaveLength(2);
    expect(reserved()).toEqual({ d1_reads_reserved: 4, d1_writes_reserved: 2, r2_class_b_reserved: 4 });
  });

  it('does not retry or refund a committed admission whose response was lost', async () => {
    sqlite.exec('UPDATE public_media_admission_allocations SET d1_reads_limit = 2, d1_writes_limit = 1, r2_class_b_limit = 2');
    const env = environment();
    const actual = database();
    env.LEDGER = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ run: async () => {
      await actual.prepare(sql).bind(...values).run();
      throw new Error('response lost after commit');
    } }) }) };
    await expectDenial(await fetchMedia(env), 503);
    expect(statements).toHaveLength(1);
    expect(reserved()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
    await expectDenial(await fetchMedia(), 503);
    expect(statements).toHaveLength(2);
    expect(heads).toEqual([]);
    expect(gets).toEqual([]);
  });
});
