import { describe, expect, it } from 'vitest';

import * as persistence from './repositories.js';

class RecordingStatement {
  bindings: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }
  first<T>() {
    return Promise.resolve(null as T | null);
  }
}

class RecordingDatabase {
  last: RecordingStatement | undefined;
  prepare(sql: string) {
    this.last = new RecordingStatement(sql);
    return this.last;
  }
}

describe('tenant-scoped persistence', () => {
  it('always scopes publication lookup by tenant', async () => {
    const createPublicationRepository = Reflect.get(persistence, 'createPublicationRepository');
    expect(createPublicationRepository).toBeTypeOf('function');
    const database = new RecordingDatabase();
    const repository = createPublicationRepository(database) as {
      findById(tenantId: string, publicationId: string): Promise<unknown>;
    };

    await repository.findById('tenant-1', 'publication-1');

    expect(database.last?.sql).toMatch(/tenant_id = \?/u);
    expect(database.last?.bindings).toEqual(['tenant-1', 'publication-1']);
    expect(Reflect.has(repository, 'get')).toBe(false);
  });

  it('scopes idempotency lookup by tenant', async () => {
    const createPublicationRepository = Reflect.get(persistence, 'createPublicationRepository');
    expect(createPublicationRepository).toBeTypeOf('function');
    const database = new RecordingDatabase();
    const repository = createPublicationRepository(database) as {
      findByIdempotencyKey(tenantId: string, key: string): Promise<unknown>;
    };

    await repository.findByIdempotencyKey('tenant-1', 'idem-1');

    expect(database.last?.sql).toMatch(/tenant_id = \?/u);
    expect(database.last?.bindings).toEqual(['tenant-1', 'idem-1']);
  });
});
