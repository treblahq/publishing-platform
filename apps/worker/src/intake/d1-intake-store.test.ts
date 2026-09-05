import { describe, expect, it } from 'vitest';

import type { PublicationEnvelope } from '@treblahq/publishing-contracts';

import * as d1Store from './d1-intake-store.js';

class Statement {
  bindings: unknown[] = [];
  constructor(readonly sql: string, readonly firstValue: unknown = null) {}
  bind(...values: unknown[]) { this.bindings = values; return this; }
  first<T>() { return Promise.resolve(this.firstValue as T | null); }
}

class Database {
  readonly statements: Statement[] = [];
  batches: Statement[][] = [];
  prepare(sql: string) {
    const statement = new Statement(sql);
    this.statements.push(statement);
    return statement;
  }
  batch(statements: Statement[]) { this.batches.push(statements); return Promise.resolve([]); }
}

const envelope = {
  schemaVersion: 1,
  identity: { tenant: 'openings', sourceType: 'job', sourceId: 'job-1', revision: 'rev-1', idempotencyKey: 'idem-1' },
  canonical: { title: 'Engineer', language: 'en' },
  artifacts: [{ id: 'image-1', storage: 'external', sha256: 'a'.repeat(64), byteSize: 10, mediaType: 'image/png', locator: 'https://example.com/image.png' }],
  deliveries: [
    { id: 'web', adapter: 'web.pages', operation: 'publish', required: true, payload: { type: 'web.page', route: '/jobs/job-1' } },
    { id: 'push', adapter: 'push.onesignal', operation: 'publish', required: true, dependsOn: [{ deliveryId: 'web', state: 'verified' }], payload: { type: 'push.notification', audience: { type: 'all-subscribers' }, title: 'New job', body: 'Engineer' } },
  ],
} satisfies PublicationEnvelope;

describe('D1 atomic intake store', () => {
  it('batches nonce, publication, deliveries, dependencies, artifacts, audit, and outbox', async () => {
    const createD1IntakeStore = Reflect.get(d1Store, 'createD1IntakeStore');
    expect(createD1IntakeStore).toBeTypeOf('function');
    const database = new Database();
    let sequence = 0;
    const store = createD1IntakeStore(database, () => `id-${String(++sequence)}`, () => '2026-09-04T15:00:00.000Z') as {
      acceptAtomic(value: { envelope: PublicationEnvelope; principal: { tenant: string; clientId: string; nonce: string } }): Promise<string>;
    };
    await expect(store.acceptAtomic({ envelope, principal: { tenant: 'openings', clientId: 'client-1', nonce: 'nonce-1' } })).resolves.toBe('id-1');

    const sql = database.batches[0]?.map((statement) => statement.sql).join('\n') ?? '';
    for (const table of ['nonces', 'publications', 'source_leases', 'deliveries', 'delivery_dependencies', 'artifacts', 'artifact_references', 'audit_events', 'outbox']) {
      expect(sql).toContain(`INTO ${table}`);
    }
    expect(database.batches).toHaveLength(1);
  });
});
