import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runD1UploadCleanup } from './d1-cleanup.js';

let sqlite: DatabaseSync;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('apps/worker/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1);
    INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash)
      VALUES ('producer', 'openings', 'pipeline', 1, 'test-hash');
    INSERT INTO capacity_reservations (id, tenant_id, resource, amount, state, expires_at)
      VALUES ('reservation', 'openings', 'r2Bytes', 10, 'reserved', '2000-01-01T00:00:00.000Z');
    INSERT INTO artifact_uploads
      (id, tenant_id, producer_client_id, locator, sha256, byte_size, media_type, state, capacity_reservation_id, expires_at)
      VALUES ('upload', 'openings', 'producer', 'temporary/openings/image.png', '${'a'.repeat(64)}', 10,
        'image/png', 'uploading', 'reservation', '2000-01-01T00:00:00.000Z');`);
});
afterEach(() => { sqlite.close(); });

function database(beforeRun: (sql: string) => void = () => {}, afterRun: (sql: string) => void = () => {}) {
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
          afterRun(sql);
          return Promise.resolve({ meta: { changes: Number(result.changes) } });
        },
      };
      return statement;
    },
  };
}

describe('upload cleanup against actual migrations', () => {
  it('deletes an expired unclaimed upload and releases its actual reservation column', async () => {
    const deleted: string[] = [];
    expect(await runD1UploadCleanup(database(), {
      delete: (key) => { deleted.push(key); return Promise.resolve(); },
    }, 10)).toBe(1);
    expect(deleted).toEqual(['temporary/openings/image.png']);
    expect(sqlite.prepare('SELECT state FROM artifact_uploads').get()).toEqual({ state: 'deleted' });
    expect(sqlite.prepare('SELECT state FROM capacity_reservations').get()).toEqual({ state: 'released' });
    expect(sqlite.prepare("SELECT cursor FROM maintenance_cursors WHERE name = 'artifact-upload-cleanup'").get())
      .toEqual({ cursor: 'upload' });
  });

  it('does not delete an upload claimed by intake after candidate selection', async () => {
    let deletes = 0;
    const db = database((sql) => {
      if (sql.includes("SET state = 'failed'")) sqlite.exec("UPDATE artifact_uploads SET state = 'claimed'");
    });
    expect(await runD1UploadCleanup(db, { delete: () => { deletes++; return Promise.resolve(); } }, 10)).toBe(0);
    expect(deletes).toBe(0);
    expect(sqlite.prepare('SELECT state FROM artifact_uploads').get()).toEqual({ state: 'claimed' });
  });

  it('preserves a retryable ledger entry when storage deletion fails', async () => {
    await expect(runD1UploadCleanup(database(), {
      delete: () => Promise.reject(new Error('storage unavailable')),
    }, 10)).rejects.toThrow('storage unavailable');
    expect(sqlite.prepare('SELECT state FROM artifact_uploads').get()).toEqual({ state: 'failed' });
    expect(sqlite.prepare('SELECT state FROM capacity_reservations').get()).toEqual({ state: 'reserved' });
    expect(await runD1UploadCleanup(database(), { delete: () => Promise.resolve() }, 10)).toBe(1);
  });

  it.each(['before', 'after'])('can recover a reservation update failure %s commit', async (stage) => {
    const fail = (sql: string) => {
      if (sql.includes('UPDATE capacity_reservations')) throw new Error('database unavailable');
    };
    const db = stage === 'before' ? database(fail) : database(() => {}, fail);
    await expect(runD1UploadCleanup(db, { delete: () => Promise.resolve() }, 10))
      .rejects.toThrow('database unavailable');
    expect(await runD1UploadCleanup(database(), { delete: () => Promise.resolve() }, 10)).toBe(1);
    expect(sqlite.prepare('SELECT state FROM capacity_reservations').get()).toEqual({ state: 'released' });
  });
});
