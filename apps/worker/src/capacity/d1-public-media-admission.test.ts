import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1PublicMediaAdmission, type PublicMediaAdmissionCost } from './d1-public-media-admission.js';
import { handlePublicMediaRequest, type PublicMediaDependencies } from '../artifacts/public-media.js';

let sqlite: DatabaseSync;
const accountId = 'a'.repeat(32);
const cost = { d1Reads: 2, d1Writes: 1, r2ClassB: 2 };
const instant = Date.parse('2026-09-09T12:00:00Z');
const now = () => new Date(instant);
let statements: string[];

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  statements = [];
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
});
afterEach(() => { sqlite.close(); });

function database() {
  return { prepare(sql: string) {
    statements.push(sql);
    expect(sql.trim()).toMatch(/^UPDATE public_media_admission_allocations\b/u);
    return { bind(...values: unknown[]) {
      return { async run() {
        await Promise.resolve();
        return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values as SQLInputValue[]).changes) } };
      } };
    } };
  } };
}

function seed() {
  sqlite.prepare(`INSERT INTO public_media_admission_allocations
    (account_id, enabled, measured_at_ms, expires_at_ms,
      d1_reads_limit, d1_reads_reserved, d1_writes_limit, d1_writes_reserved, r2_class_b_limit, r2_class_b_reserved)
    VALUES (?, 1, ?, ?, 2, 0, 1, 0, 2, 0)`).run(accountId, instant, instant + 900_000);
}

function counters() {
  return sqlite.prepare(`SELECT d1_reads_reserved, d1_writes_reserved, r2_class_b_reserved
    FROM public_media_admission_allocations WHERE account_id = ?`).get(accountId);
}

describe('finite durable public media admission', () => {
  it('creates an empty allocation table and admits exactly the final cost vector', async () => {
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'public_media_admission_allocations'").get())
      .toEqual({ name: 'public_media_admission_allocations' });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM public_media_admission_allocations').get()).toEqual({ count: 0 });
    seed();
    const admit = createD1PublicMediaAdmission(database(), accountId, cost, now);
    expect(await admit()).toBe(true);
    expect(await admit()).toBe(false);
    expect(counters()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
    expect(statements).toHaveLength(2);
  });

  it.each(['d1_reads', 'd1_writes', 'r2_class_b'])('denies exhausted %s without partial reservation', async (dimension) => {
    seed();
    sqlite.exec(`UPDATE public_media_admission_allocations SET ${dimension}_reserved = ${dimension}_limit`);
    const before = counters();
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, now)()).toBe(false);
    expect(counters()).toEqual(before);
    expect(statements).toHaveLength(1);
  });

  it.each([
    ['missing', 'DELETE FROM public_media_admission_allocations'],
    ['disabled', 'UPDATE public_media_admission_allocations SET enabled = 0'],
    ['future', `UPDATE public_media_admission_allocations SET measured_at_ms = ${String(instant + 1)}`],
    ['expired', `UPDATE public_media_admission_allocations SET measured_at_ms = ${String(instant - 900_000)}, expires_at_ms = ${String(instant - 1)}`],
    ['exact expiry', `UPDATE public_media_admission_allocations SET measured_at_ms = ${String(instant - 900_000)}, expires_at_ms = ${String(instant)}`],
  ])('denies %s allocation without resetting it', async (_label, sql) => {
    seed();
    sqlite.exec(sql);
    const before = counters();
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, now)()).toBe(false);
    expect(counters()).toEqual(before);
    expect(statements).toHaveLength(1);
  });

  it('admits one millisecond before expiry but denies at the exact boundary', async () => {
    seed();
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, () => new Date(instant + 899_999))()).toBe(true);
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, () => new Date(instant + 900_000))()).toBe(false);
  });

  it('denies a still-live allocation at UTC midnight without resetting consumed counters', async () => {
    seed();
    const midnight = Date.parse('2026-09-10T00:00:00Z');
    sqlite.prepare(`UPDATE public_media_admission_allocations SET measured_at_ms = ?, expires_at_ms = ?,
      d1_reads_limit = 4, d1_writes_limit = 2, r2_class_b_limit = 4`).run(midnight - 1, midnight + 899_999);
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, () => new Date(midnight - 1))()).toBe(true);
    const before = counters();
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, () => new Date(midnight))()).toBe(false);
    expect(counters()).toEqual(before);
  });

  it.each([null, undefined, 123, '', 'a'.repeat(31), 'a'.repeat(33), 'A'.repeat(32), 'g'.repeat(32), `${'a'.repeat(32)}\n`])(
    'rejects invalid account %j before SQL', async (account) => {
      expect(await createD1PublicMediaAdmission(database(), account as string, cost, now)()).toBe(false);
      expect(statements).toHaveLength(0);
    },
  );

  it.each(['d1Reads', 'd1Writes', 'r2ClassB'] as const)('validates every %s cost before SQL', async (dimension) => {
    for (const value of [undefined, null, '2', NaN, Infinity, -Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, cost[dimension] - 1]) {
      const invalid = { ...cost, [dimension]: value };
      expect(await createD1PublicMediaAdmission(database(), accountId, invalid, now)()).toBe(false);
    }
    expect(statements).toHaveLength(0);
  });

  it.each([null, undefined, 2, 'cost', {}])('denies malformed cost configuration %j before SQL', async (invalid) => {
    expect(await createD1PublicMediaAdmission(database(), accountId, invalid as PublicMediaAdmissionCost, now)()).toBe(false);
    expect(statements).toHaveLength(0);
  });

  it.each([() => new Date(NaN), () => null, () => instant, () => new Date(-1),
    () => { throw new Error('clock unavailable'); }])('denies invalid or throwing clock before SQL', async (clock) => {
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, clock as () => Date)()).toBe(false);
    expect(statements).toHaveLength(0);
  });

  it('captures the clock once per request and copies the caller cost once', async () => {
    seed();
    const mutableCost = { ...cost };
    let clockCalls = 0;
    const admit = createD1PublicMediaAdmission(database(), accountId, mutableCost, () => {
      clockCalls++;
      return clockCalls === 1 ? now() : new Date(instant + 900_000);
    });
    mutableCost.d1Reads = 100;
    mutableCost.d1Writes = 100;
    mutableCost.r2ClassB = 100;
    expect(await admit()).toBe(true);
    expect(clockCalls).toBe(1);
    expect(await admit()).toBe(false);
    expect(clockCalls).toBe(2);
    expect(counters()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
  });

  it('keeps exhaustion durable across fresh factories', async () => {
    seed();
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, now)()).toBe(true);
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, now)()).toBe(false);
    expect(counters()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
  });

  it('shares a finite allocation across overlapping factories without oversubscription', async () => {
    seed();
    sqlite.exec('UPDATE public_media_admission_allocations SET d1_reads_limit = 20, d1_writes_limit = 10, r2_class_b_limit = 20');
    const callers = Array.from({ length: 40 }, () => createD1PublicMediaAdmission(database(), accountId, cost, now));
    expect((await Promise.all(callers.map((admit) => admit()))).filter(Boolean)).toHaveLength(10);
    expect(counters()).toEqual({ d1_reads_reserved: 20, d1_writes_reserved: 10, r2_class_b_reserved: 20 });
    expect(statements).toHaveLength(40);
  });

  it.each([null, undefined, {}, { success: true }, { meta: { changes: 1 } },
    { success: false, meta: { changes: 1 } }, { success: 1, meta: { changes: 1 } },
    { success: true, meta: null }, { success: true, meta: {} },
    ...[0, 2, -1, 1.5, NaN, Infinity, '1'].map((changes) => ({ success: true, meta: { changes } })),
  ])('denies ambiguous write metadata %j', async (result) => {
    let calls = 0;
    const db = { prepare: () => ({ bind: () => ({ run: () => { calls++; return Promise.resolve(result); } }) }) };
    expect(await createD1PublicMediaAdmission(db as Parameters<typeof createD1PublicMediaAdmission>[0], accountId, cost, now)()).toBe(false);
    expect(calls).toBe(1);
  });

  it.each(['prepare', 'bind', 'run'])('denies %s failures without retry', async (stage) => {
    let failures = 0;
    const fail = () => { failures++; throw new Error('D1 unavailable'); };
    const db = { prepare: () => {
      if (stage === 'prepare') fail();
      return { bind: () => {
        if (stage === 'bind') fail();
        return { run: async () => { await Promise.resolve(); return fail(); } };
      } };
    } };
    expect(await createD1PublicMediaAdmission(db, accountId, cost, now)()).toBe(false);
    expect(failures).toBe(1);
  });

  it('does not refund or retry a committed reservation whose response is lost', async () => {
    seed();
    const db = database();
    const lostResponse = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ run: async () => {
      await db.prepare(sql).bind(...values).run();
      throw new Error('response lost after commit');
    } }) }) };
    expect(await createD1PublicMediaAdmission(lostResponse, accountId, cost, now)()).toBe(false);
    expect(statements).toHaveLength(1);
    expect(counters()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
    expect(await createD1PublicMediaAdmission(database(), accountId, cost, now)()).toBe(false);
    expect(statements).toHaveLength(2);
  });

  it.each(['measured_at_ms', 'expires_at_ms', 'd1_reads_limit', 'd1_reads_reserved',
    'd1_writes_limit', 'd1_writes_reserved', 'r2_class_b_limit', 'r2_class_b_reserved'])(
    'migration constrains %s to nonnegative safe integers', (column) => {
      seed();
      for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid', null]) {
        expect(() => sqlite.prepare(`UPDATE public_media_admission_allocations SET ${column} = ?`).run(value)).toThrow();
      }
    },
  );

  it.each([
    "account_id = 'ABC'", `account_id = '${'A'.repeat(32)}'`, `account_id = '${'g'.repeat(32)}'`,
    'enabled = 2', 'enabled = 0.5', 'enabled = NULL', 'expires_at_ms = measured_at_ms',
    'expires_at_ms = measured_at_ms + 900001', 'd1_reads_reserved = 3', 'd1_writes_reserved = 2', 'r2_class_b_reserved = 3',
  ])('migration rejects invalid allocation: %s', (assignment) => {
    seed();
    expect(() => { sqlite.exec(`UPDATE public_media_admission_allocations SET ${assignment}`); }).toThrow();
  });

  it('rejects account keys containing a hidden NUL suffix', () => {
    seed();
    expect(() => sqlite.prepare('UPDATE public_media_admission_allocations SET account_id = ?')
      .run(`${accountId}\0hidden`)).toThrow();
  });

  it('permits safe maximum ceilings and rejects duplicate account rows', async () => {
    seed();
    sqlite.exec(`UPDATE public_media_admission_allocations SET d1_reads_limit = 9007199254740991,
      d1_reads_reserved = 9007199254740989, d1_writes_limit = 9007199254740991,
      d1_writes_reserved = 9007199254740990, r2_class_b_limit = 9007199254740991,
      r2_class_b_reserved = 9007199254740989`);
    expect(() => { seed(); }).toThrow();
    const admit = createD1PublicMediaAdmission(database(), accountId, cost, now);
    expect(await admit()).toBe(true);
    expect(await admit()).toBe(false);
    expect(counters()).toEqual({ d1_reads_reserved: Number.MAX_SAFE_INTEGER,
      d1_writes_reserved: Number.MAX_SAFE_INTEGER, r2_class_b_reserved: Number.MAX_SAFE_INTEGER });
  });

  function transport(tenant: string) {
    const identity = { tenant, artifactId: 'artifact_12345678', sha256: 'a'.repeat(64) };
    const grant = { ...identity, locator: `temporary/${tenant}/card.png`, byteSize: 10,
      mediaType: 'image/png', expiresAt: '2026-09-09T13:00:00Z' };
    const calls = { resolve: 0, head: 0, get: 0 };
    const dependencies: PublicMediaDependencies = { enabled: true, now,
      admit: createD1PublicMediaAdmission(database(), accountId, cost, now),
      resolve: () => { calls.resolve++; return Promise.resolve(grant); },
      bucket: {
        head: () => {
          calls.head++;
          return Promise.resolve({ size: 10, httpMetadata: { contentType: 'image/png' },
            customMetadata: { tenant, sha256: identity.sha256, mediaType: 'image/png' },
            checksums: { sha256: new Uint8Array(32).fill(170).buffer } });
        },
        get: () => { calls.get++; return Promise.resolve(null); },
      },
    };
    const request = new Request(`https://media.example/media/${tenant}/${identity.artifactId}/${identity.sha256}`, { method: 'HEAD' });
    return { calls, dependencies, request };
  }

  it('admits a verified HTTP 200 then denies another tenant before resolver or bucket', async () => {
    seed();
    const first = transport('openings');
    const second = transport('other');
    expect((await handlePublicMediaRequest(first.request, first.dependencies)).status).toBe(200);
    expect(first.calls).toEqual({ resolve: 1, head: 1, get: 0 });
    expect((await handlePublicMediaRequest(second.request, second.dependencies)).status).toBe(503);
    expect(second.calls).toEqual({ resolve: 0, head: 0, get: 0 });
  });

  it('bounds overlapping HTTP requests from mixed tenants by the shared account', async () => {
    seed();
    sqlite.exec('UPDATE public_media_admission_allocations SET d1_reads_limit = 10, d1_writes_limit = 5, r2_class_b_limit = 10');
    const clients = Array.from({ length: 20 }, (_, index) => transport(index % 2 ? 'openings' : 'other'));
    const responses = await Promise.all(clients.map(({ request, dependencies }) => handlePublicMediaRequest(request, dependencies)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(5);
    expect(responses.filter((response) => response.status === 503)).toHaveLength(15);
    expect(clients.reduce((count, client) => count + client.calls.resolve, 0)).toBe(5);
    expect(counters()).toEqual({ d1_reads_reserved: 10, d1_writes_reserved: 5, r2_class_b_reserved: 10 });
    expect(statements).toHaveLength(20);
  });

  it.each(['grant', 'object'])('keeps the reservation consumed after downstream %s 404', async (failure) => {
    seed();
    const client = transport('openings');
    if (failure === 'grant') client.dependencies.resolve = () => Promise.resolve(null);
    else client.dependencies.bucket.head = () => Promise.resolve(null);
    expect((await handlePublicMediaRequest(client.request, client.dependencies)).status).toBe(404);
    expect(counters()).toEqual({ d1_reads_reserved: 2, d1_writes_reserved: 1, r2_class_b_reserved: 2 });
    expect((await handlePublicMediaRequest(client.request, client.dependencies)).status).toBe(503);
  });
});
