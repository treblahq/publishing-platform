import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { expect, it } from 'vitest';
import { buildSignedHeaders } from '@trebla/publishing';
import { createD1IntakeStore, type D1IntakeStatement } from './d1-intake-store.js';
import { handlePublicationRequest } from './routes.js';

const instant = '2026-09-04T15:00:00.000Z';
const envelope = {
  schemaVersion: 1,
  identity: { tenant: 'openings', sourceType: 'job', sourceId: 'job', revision: '1', idempotencyKey: 'key' },
  canonical: { title: 'Engineer', language: 'en' }, artifacts: [],
  deliveries: [{ id: 'shadow', adapter: 'social.shadow', operation: 'publish', required: true,
    payload: { type: 'social.post', text: 'Engineer role' } }],
};
const client = { id: 'client', tenant: 'openings', enabled: true, secret: 'test-only-secret' };

async function request() {
  const body = JSON.stringify(envelope);
  const headers = await buildSignedHeaders({ clientId: client.id, secret: client.secret,
    method: 'POST', path: '/v1/publications', tenant: client.tenant, timestamp: instant, nonce: 'nonce', body });
  return new Request('https://worker.test/v1/publications', { method: 'POST', body, headers });
}

it.each(['d1Rows', 'queueOperations'])('returns retry-later after another tenant exhausts atomic %s capacity', async resource => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('apps/worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
    }
    sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('troco', 'Troco', 1);
      INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash) VALUES ('client', 'openings', 'test', 1, 'test-hash');`);
    sqlite.prepare(`INSERT INTO capacity_usage (tenant_id, resource, window_start, used, measured_at)
      SELECT 'troco', resource, '2026-09-04T00:00:00.000Z', reject_limit - 1, ? FROM capacity_limits WHERE resource = ?`)
      .run(instant, resource);
    const before = sqlite.prepare('SELECT * FROM capacity_usage').all();
    const bindings = new WeakMap<D1IntakeStatement, { sql: string; values: SQLInputValue[] }>();
    const database = {
      prepare(sql: string): D1IntakeStatement {
        const data = { sql, values: [] as SQLInputValue[] };
        const statement: D1IntakeStatement = {
          bind(...values: unknown[]) { data.values = values as SQLInputValue[]; return statement; },
          first<T>() { return Promise.resolve((sqlite.prepare(sql).get(...data.values) ?? null) as T | null); },
        };
        bindings.set(statement, data);
        return statement;
      },
      batch(statements: D1IntakeStatement[]) {
        sqlite.exec('BEGIN');
        try {
          for (const statement of statements) {
            const data = bindings.get(statement);
            if (!data) throw new Error('Missing fixture statement');
            sqlite.prepare(data.sql).run(...data.values);
          }
          sqlite.exec('COMMIT');
          return Promise.resolve([]);
        } catch (error) {
          sqlite.exec('ROLLBACK');
          return Promise.reject(error instanceof Error ? error : new Error('Unexpected fixture failure'));
        }
      },
    };
    const response = await handlePublicationRequest(await request(), {
      now: () => new Date(instant), loadClient: () => Promise.resolve(client),
      capacity: () => Promise.resolve({ accepted: true }), artifactsReady: () => Promise.resolve(true),
      store: createD1IntakeStore(database, undefined, () => instant),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ outcome: 'retry-later', code: 'FREE_TIER_BUDGET_EXHAUSTED',
      publicationAccepted: false, retryAfter: '2026-09-05T00:00:00.000Z' });
    expect(response.headers.get('retry-after')).toBe('Sat, 05 Sep 2026 00:00:00 GMT');
    for (const table of ['nonces', 'publications', 'source_leases', 'deliveries', 'outbox', 'audit_events', 'capacity_reservations']) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get(), table).toEqual({ total: 0 });
    }
    expect(sqlite.prepare('SELECT * FROM capacity_usage').all()).toEqual(before);
  } finally { sqlite.close(); }
});

const cyclicError = new Error('cyclic cause');
cyclicError.cause = cyclicError;
const deeplyWrapped = Array.from({ length: 4 }).reduce<Error>(
  error => new Error('wrapper', { cause: error }), new Error('free-tier capacity reservation rejected'),
);

it.each([
  [new Error('D1_ERROR: free-tier capacity reservation rejected: SQLITE_CONSTRAINT'), 429],
  [new Error('query failed', { cause: new Error('free-tier capacity reservation rejected') }), 429],
  [new Error('other capacity failure with private diagnostics'), 400],
  ['free-tier capacity reservation rejected', 400],
  [cyclicError, 400],
  [deeplyWrapped, 400],
])('only translates known durable exhaustion without exposing diagnostics: %s', async (error, status) => {
  const response = await handlePublicationRequest(await request(), {
    now: () => new Date(instant), loadClient: () => Promise.resolve(client),
    capacity: () => Promise.resolve({ accepted: true }), artifactsReady: () => Promise.resolve(true),
    store: { findByIdempotencyKey: () => Promise.resolve(null),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Deliberately test non-Error rejection handling.
      acceptAtomic: () => Promise.reject(error) },
  });
  expect(response.status).toBe(status);
  const body = await response.text();
  expect(body).not.toMatch(/private diagnostics|query failed|SQLITE_CONSTRAINT/);
});
