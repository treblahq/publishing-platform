import { describe, expect, it } from 'vitest';

import { createD1UploadStore } from './d1-uploads.js';

class Statement {
  bindings: unknown[] = [];
  constructor(readonly sql: string, readonly firstValue: unknown = null) {}
  bind(...values: unknown[]) { this.bindings = values; return this; }
  first<T>() { return Promise.resolve(this.firstValue as T | null); }
  run() { return Promise.resolve({}); }
}

class Database {
  readonly statements: Statement[] = [];
  readonly batches: Statement[][] = [];
  constructor(private readonly rows: unknown[] = []) {}
  prepare(sql: string) {
    const statement = new Statement(sql, sql.includes('FROM artifact_uploads') ? this.rows.shift() : null);
    this.statements.push(statement);
    return statement;
  }
  batch(statements: Statement[]) { this.batches.push(statements); return Promise.resolve([]); }
}

const request = {
  tenant: 'troco', clientId: 'troco-local', nonce: 'nonce-1',
  locator: `temporary/troco/campaign/${'a'.repeat(64)}.mp4`, sha256: 'a'.repeat(64),
  byteSize: 5, mediaType: 'video/mp4', now: new Date('2026-09-05T12:00:00.000Z'),
};

describe('D1 temporary upload store', () => {
  it('atomically reserves capacity, nonce, and upload identity', async () => {
    const database = new Database([null]);
    const store = createD1UploadStore(database, () => 'upload-1');

    await expect(store.reserve(request)).resolves.toEqual({ outcome: 'reserved', uploadId: 'upload-1' });

    const sql = database.batches[0]?.map(({ sql }) => sql).join('\n') ?? '';
    expect(sql).toContain('INTO artifact_upload_nonces');
    expect(sql).toContain('INTO capacity_reservations');
    expect(sql).toContain('INTO artifact_uploads');
  });

  it('returns an identical available upload without reserving bytes twice', async () => {
    const database = new Database([{
      id: 'upload-1', sha256: request.sha256, byte_size: request.byteSize,
      media_type: request.mediaType, state: 'available', expires_at: '2026-09-06T12:00:00.000Z',
    }]);
    const store = createD1UploadStore(database);

    await expect(store.reserve(request)).resolves.toEqual({ outcome: 'already-available', uploadId: 'upload-1' });
    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]?.map(({ sql }) => sql).join('\n')).not.toContain('INTO capacity_reservations');
  });

  it('rejects immutable locator reuse with different metadata', async () => {
    const database = new Database([{
      id: 'upload-1', sha256: 'b'.repeat(64), byte_size: request.byteSize,
      media_type: request.mediaType, state: 'available', expires_at: '2026-09-06T12:00:00.000Z',
    }]);

    await expect(createD1UploadStore(database).reserve(request))
      .resolves.toEqual({ outcome: 'conflict' });
    expect(database.batches).toHaveLength(1);
  });

  it('marks verified bytes available and consumes their reservation', async () => {
    const database = new Database();
    await createD1UploadStore(database).markAvailable('troco', 'upload-1', request.now);

    const sql = database.batches[0]?.map(({ sql }) => sql).join('\n') ?? '';
    expect(sql).toContain("state = 'available'");
    expect(sql).toContain("state = 'consumed'");
    expect(sql).toContain('INTO capacity_usage');
    expect(sql).toContain("state = 'uploading'");
    expect(database.batches[0]?.[0]?.sql).toContain('INTO capacity_usage');
  });

  it('releases capacity after a failed streamed upload', async () => {
    const database = new Database();
    await createD1UploadStore(database).markFailed('troco', 'upload-1', request.now);

    const sql = database.batches[0]?.map(({ sql }) => sql).join('\n') ?? '';
    expect(sql).toContain("state = 'released'");
    expect(sql).toContain("state = 'failed'");
  });
});
