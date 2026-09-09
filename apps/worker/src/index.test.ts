import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { createWorker } from './index.js';

describe('worker HTTP router', () => {
  it('serves web entities when Mastodon is configured with a Worker secret', async () => {
    const row = { kind: 'job', entity_id: 'gh_123', revision: 'r1', status: 'active',
      title: 'Engineer', canonical_path: '/jobs/gh_123', content_sha256: 'a'.repeat(64), object_key: 'entity.json' };
    const statement = { bind: () => statement, first: () => Promise.resolve(row) };
    const shell = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html><head><title>Shell</title></head><body></body></html>'));
    try {
      const response = await createWorker().fetch(new Request('https://worker.test/web/openings/jobs/gh_123'), {
        LEDGER: { prepare: () => statement }, ARTIFACTS: { head: () => Promise.resolve({ size: 1 }) },
        DELIVERY_QUEUE: {}, DELIVERY_DLQ: {},
        CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }),
        ENABLED_ADAPTERS: 'web.r2,social.shadow,social.mastodon',
        MASTODON_ACCESS_TOKENS: JSON.stringify({ openings: 'test-only-token' }),
        ADAPTER_CONFIGS: JSON.stringify({ openings: {
          'web.r2': { shellBaseUrl: 'https://openings-dev-web-dfy.pages.dev', canonicalBaseUrl: 'https://openings.dev' },
          'social.mastodon': { baseUrl: 'https://mastodon.social' },
        } }),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<title>Engineer | openings.dev</title>');
      expect(shell).toHaveBeenCalledOnce();
      expect(shell.mock.calls[0]?.[0]).toEqual(new URL('https://openings-dev-web-dfy.pages.dev/route-indexes/jobs/'));
    } finally { shell.mockRestore(); }
  });

  it('keeps liveness independent from every durable binding', async () => {
    const response = await createWorker().fetch(new Request('https://worker.test/health/live'), {});
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'live' });
  });

  it('routes publication intake through runtime dependencies', async () => {
    const handler = vi.fn().mockResolvedValue(new Response('accepted', { status: 202 }));
    const worker = createWorker({ publicationHandler: handler });
    const request = new Request('https://worker.test/v1/publications', { method: 'POST' });
    const response = await worker.fetch(request, { marker: true });
    expect(response.status).toBe(202);
    expect(handler).toHaveBeenCalledWith(request, { marker: true });
  });

  it('routes artifact uploads without waking delivery work', async () => {
    const artifactHandler = vi.fn().mockResolvedValue(new Response('stored', { status: 201 }));
    const scheduledHandler = vi.fn();
    const outboxHandler = vi.fn();
    const waitUntil = vi.fn();
    const worker = createWorker({ artifactHandler, scheduledHandler, outboxHandler });
    const request = new Request('https://worker.test/v1/artifacts', { method: 'PUT' });

    const response = await worker.fetch(request, { marker: true }, { waitUntil } as unknown as ExecutionContext);

    expect(response.status).toBe(201);
    expect(artifactHandler).toHaveBeenCalledWith(request, { marker: true });
    expect(scheduledHandler).not.toHaveBeenCalled();
    expect(outboxHandler).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('wakes the durable outbox immediately after accepted intake', async () => {
    const publicationHandler = vi.fn().mockResolvedValue(new Response('accepted', { status: 202 }));
    const outboxHandler = vi.fn().mockResolvedValue(1);
    const scheduledHandler = vi.fn();
    const waitUntil = vi.fn();
    const worker = createWorker({ publicationHandler, outboxHandler, scheduledHandler });
    await worker.fetch(
      new Request('https://worker.test/v1/publications', { method: 'POST' }),
      { marker: true },
      { waitUntil } as unknown as ExecutionContext,
    );
    expect(outboxHandler).toHaveBeenCalledWith({ marker: true });
    expect(scheduledHandler).not.toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it('does not run account maintenance after each accepted HTTP request', async () => {
    const prepare = vi.fn((sql: string) => {
      if (!sql.includes('UPDATE outbox SET claim_token')) throw new Error('Unexpected maintenance query');
      const statement = { bind: () => statement, all: () => Promise.resolve({ results: [] }) };
      return statement;
    });
    const pending: Promise<unknown>[] = [];
    const send = vi.fn();
    const worker = createWorker({
      publicationHandler: () => Promise.resolve(new Response(null, { status: 202 })),
    });
    const response = await worker.fetch(new Request('https://worker.test/v1/publications', { method: 'POST' }), {
      LEDGER: { prepare }, DELIVERY_QUEUE: { send }, DELIVERY_DLQ: {}, ARTIFACTS: {},
      CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }),
      ENABLED_ADAPTERS: '',
    }, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext);
    expect(response.status).toBe(202);
    expect(pending).toHaveLength(1);
    await expect(pending[0]).resolves.toBe(0);
    expect(prepare).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not wake delivery work for rejected intake', async () => {
    const scheduledHandler = vi.fn();
    const outboxHandler = vi.fn();
    const waitUntil = vi.fn();
    const worker = createWorker({
      publicationHandler: () => Promise.resolve(new Response('invalid', { status: 400 })),
      scheduledHandler,
      outboxHandler,
    });
    await worker.fetch(new Request('https://worker.test/v1/publications'), {}, { waitUntil } as unknown as ExecutionContext);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(outboxHandler).not.toHaveBeenCalled();
    expect(scheduledHandler).not.toHaveBeenCalled();
  });

  it('dispatches only one persisted outbox row from accepted HTTP intake', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      for (const file of readdirSync('apps/worker/migrations').filter(name => name.endsWith('.sql')).sort()) {
        sqlite.exec(readFileSync(`apps/worker/migrations/${file}`, 'utf8'));
      }
      sqlite.exec(`INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1);
        INSERT INTO producer_clients (id, tenant_id, name, secret_hash, enabled) VALUES ('client', 'openings', 'test', 'hash', 1);
        INSERT INTO publications (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
          VALUES ('publication', 'openings', 'client', 'test', 'source', '1', 'key', '{}', 'accepted');`);
      for (const id of ['a', 'b', 'c']) {
        sqlite.prepare(`INSERT INTO deliveries (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
          VALUES (?, 'openings', 'publication', ?, 'social.shadow', 'publish', 1, '{}', 'ready')`).run(id, id);
        sqlite.prepare(`INSERT INTO outbox (id, tenant_id, delivery_id, event_type, payload_json, due_at)
          VALUES (?, 'openings', ?, 'delivery.ready', '{}', '2026-01-01T00:00:00.000Z')`).run(id, id);
      }
      const database = { prepare(sql: string) {
        let values: SQLInputValue[] = [];
        const statement = {
          bind(...inputs: unknown[]) { values = inputs as SQLInputValue[]; return statement; },
          all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...values) }),
          run: () => Promise.resolve(sqlite.prepare(sql).run(...values)),
        };
        return statement;
      } };
      const pending: Promise<unknown>[] = [];
      const send = vi.fn().mockResolvedValue(undefined);
      const response = await createWorker({ publicationHandler: () => Promise.resolve(new Response(null, { status: 202 })) })
        .fetch(new Request('https://worker.test/v1/publications', { method: 'POST' }), {
          LEDGER: database, DELIVERY_QUEUE: { send }, DELIVERY_DLQ: {}, ARTIFACTS: {},
          CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }),
          ENABLED_ADAPTERS: '',
        }, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext);
      expect(response.status).toBe(202);
      await expect(pending[0]).resolves.toBe(1);
      expect(send).toHaveBeenCalledOnce();
      expect(sqlite.prepare('SELECT id FROM outbox WHERE dispatched_at IS NOT NULL').all()).toEqual([{ id: 'a' }]);
      expect(sqlite.prepare('SELECT id FROM outbox WHERE dispatched_at IS NULL AND claim_token IS NULL AND claimed_until IS NULL ORDER BY id').all())
        .toEqual([{ id: 'b' }, { id: 'c' }]);
    } finally { sqlite.close(); }
  });

  it.each(['binding', 'query'])('does not swallow a background %s failure', async (failure) => {
    const pending: Promise<unknown>[] = [];
    const environment = failure === 'binding' ? {} : {
      LEDGER: { prepare: () => { throw new Error('Outbox unavailable'); } },
      DELIVERY_QUEUE: {}, DELIVERY_DLQ: {}, ARTIFACTS: {},
      CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }),
      ENABLED_ADAPTERS: '',
    };
    const response = await createWorker({
      publicationHandler: () => Promise.resolve(new Response(null, { status: 202 })),
    }).fetch(new Request('https://worker.test/v1/publications', { method: 'POST' }), environment,
      { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext);
    expect(response.status).toBe(202);
    expect(pending).toHaveLength(1);
    await expect(pending[0]).rejects.toThrow(failure === 'query' ? 'Outbox unavailable' : 'capacity configuration');
  });

  it('does not expose an accidental catch-all route', async () => {
    const response = await createWorker().fetch(new Request('https://worker.test/unknown'), {});
    expect(response.status).toBe(404);
  });

  it('dispatches durable outbox work from the scheduled trigger', async () => {
    const scheduledHandler = vi.fn().mockResolvedValue(2);
    const outboxHandler = vi.fn();
    const waitUntil = vi.fn();
    createWorker({ scheduledHandler, outboxHandler }).scheduled({} as ScheduledController, { marker: true }, { waitUntil } as unknown as ExecutionContext);
    expect(outboxHandler).not.toHaveBeenCalled();
    expect(scheduledHandler).toHaveBeenCalledWith({ marker: true });
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBe(2);
  });

  it('preserves all maintenance stages on the default scheduled path', async () => {
    const queries: string[] = [];
    let outboxLimit: unknown;
    const prepare = vi.fn((sql: string) => {
      queries.push(sql);
      const statement = { bind: (...values: unknown[]) => {
        if (sql.includes('UPDATE outbox SET claim_token')) outboxLimit = values[2];
        return statement;
      },
        all: () => Promise.resolve({ results: [] }), first: () => Promise.resolve(null) };
      return statement;
    });
    const pending: Promise<unknown>[] = [];
    createWorker().scheduled({} as ScheduledController, {
      LEDGER: { prepare }, DELIVERY_QUEUE: {}, DELIVERY_DLQ: {}, ARTIFACTS: {},
      CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }),
      ENABLED_ADAPTERS: '', ADAPTER_CONFIGS: '{}',
    }, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } as unknown as ExecutionContext);
    await expect(pending[0]).resolves.toBe(0);
    expect(queries).toHaveLength(8);
    expect(queries[0]).toContain('SELECT id FROM tenants');
    expect(queries[1]).toContain("state IN ('reconciling', 'processing', 'delivering')");
    expect(queries[2]).toContain("state = 'retry_wait'");
    expect(queries[3]).toContain("name = 'artifact-upload-cleanup'");
    expect(queries[4]).toContain('FROM artifact_uploads');
    expect(queries[5]).toContain("name = 'artifact-cleanup'");
    expect(queries[6]).toContain('FROM artifacts AS artifact');
    expect(queries[7]).toContain('UPDATE outbox SET claim_token');
    expect(outboxLimit).toBe(50);
  });

  it('routes queue batches through the durable consumer', async () => {
    const queueHandler = vi.fn().mockResolvedValue(undefined);
    const batch = { messages: [] } as unknown as MessageBatch;
    await createWorker({ queueHandler }).queue(batch, { marker: true });
    expect(queueHandler).toHaveBeenCalledWith(batch, { marker: true });
  });

  it('routes admin requests through authenticated runtime operations', async () => {
    const adminHandler = vi.fn().mockResolvedValue(Response.json({ ready: true }));
    const request = new Request('https://worker.test/admin/health/ready');
    const response = await createWorker({ adminHandler }).fetch(request, { marker: true });
    expect(response.status).toBe(200);
    expect(adminHandler).toHaveBeenCalledWith(request, { marker: true });
  });
});
