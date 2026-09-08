import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { WebEntityRevision } from '@trebla/publishing';
import { createD1R2EntityStores } from './d1-entity-stores.js';

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('apps/worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec("INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1), ('troco', 'Troco', 1)");
});
afterEach(() => { sqlite.close(); });

function manifests(tenant = 'openings') {
  return createD1R2EntityStores({
    prepare(sql: string) {
      let values: SQLInputValue[] = [];
      const statement = {
        bind(...inputs: unknown[]) { values = inputs as SQLInputValue[]; return statement; },
        first: () => Promise.resolve(sqlite.prepare(sql).get(...values) ?? null),
        run: () => Promise.resolve(sqlite.prepare(sql).run(...values)),
      };
      return statement;
    },
  }, {} as R2Bucket, tenant).manifests;
}

function entity(hash = 'a', revision = 'r1'): WebEntityRevision {
  return {
    schemaVersion: 1, tenant: 'openings', kind: 'job', id: 'job-1', revision,
    canonicalPath: '/jobs/job-1', title: 'Engineer', status: 'active',
    contentSha256: hash.repeat(64), content: {},
  };
}

it.each([false, true])('rejects conflicting concurrent writers (existing entity: %s)', async existing => {
  const store = manifests();
  if (existing) await store.activate(entity('c', 'r0'), 'old');
  const results = await Promise.allSettled([
    store.activate(entity('a'), 'object-a'),
    store.activate(entity('b'), 'object-b'),
  ]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((results[1] as PromiseRejectedResult).reason).toEqual(new Error('Revision reuse has different content'));
  expect(await store.find('job', 'job-1')).toMatchObject({
    revision: 'r1', contentSha256: 'a'.repeat(64), objectKey: 'object-a',
  });
});

it('allows matching replay and a distinct revision', async () => {
  const store = manifests();
  await store.activate(entity(), 'object-a');
  await store.activate(entity(), 'object-a');
  await store.activate(entity('b', 'r2'), 'object-b');
  expect(await store.find('job', 'job-1')).toMatchObject({ revision: 'r2', objectKey: 'object-b' });
});

it('keeps identical entity keys isolated by tenant', async () => {
  await manifests().activate(entity(), 'object-a');
  await manifests('troco').activate({ ...entity('b'), tenant: 'troco' }, 'object-b');
  expect(await manifests().find('job', 'job-1')).toMatchObject({ objectKey: 'object-a' });
  expect(await manifests('troco').find('job', 'job-1')).toMatchObject({ objectKey: 'object-b' });
});
