import type { AdminDependencies } from './routes.js';

interface Statement {
  bind(...values: unknown[]): Statement;
  first(): Promise<unknown>;
  all(): Promise<{ results?: unknown[] }>;
}
interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export function createD1AdminDependencies(
  database: Database,
  token: string,
  createId: () => string = () => crypto.randomUUID(),
): AdminDependencies {
  return {
    token,
    ready: async () => {
      const checks = await database.prepare(`SELECT
        (SELECT COUNT(*) FROM outbox WHERE dispatched_at IS NULL AND due_at < datetime('now', '-15 minutes')) AS stale_outbox,
        (SELECT COUNT(*) FROM deliveries WHERE lease_expires_at < datetime('now')) AS expired_leases,
        (SELECT COUNT(*) FROM deliveries WHERE state = 'needs_attention') AS needs_attention`).first();
      return { ready: checks !== null, checks };
    },
    inspect: async (tenant, publicationId) => {
      const publication = await database.prepare(`SELECT id, source_type, source_id, revision, state, created_at, updated_at
        FROM publications WHERE tenant_id = ? AND id = ? LIMIT 1`).bind(tenant, publicationId).first();
      const deliveries = await database.prepare(`SELECT id, delivery_key, adapter, state, due_at, updated_at
        FROM deliveries WHERE tenant_id = ? AND publication_id = ? ORDER BY delivery_key`)
        .bind(tenant, publicationId).all();
      return { publication, deliveries: deliveries.results ?? [] };
    },
    listDeliveries: async (tenant, state) => {
      const query = state === undefined
        ? database.prepare(`SELECT id, publication_id, delivery_key, adapter, state, due_at, updated_at
            FROM deliveries WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 100`).bind(tenant)
        : database.prepare(`SELECT id, publication_id, delivery_key, adapter, state, due_at, updated_at
            FROM deliveries WHERE tenant_id = ? AND state = ? ORDER BY updated_at DESC LIMIT 100`).bind(tenant, state);
      return (await query.all()).results ?? [];
    },
    replay: async (tenant, deliveryId, reason) => {
      const outboxId = `replay:${tenant}:${deliveryId}`;
      await database.batch([
        database.prepare(`UPDATE deliveries SET state = 'ready', due_at = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE tenant_id = ? AND id = ? AND state IN ('needs_attention','retry_wait','reconciling')`).bind(tenant, deliveryId),
        database.prepare(`INSERT INTO outbox (id, tenant_id, delivery_id, event_type, payload_json, due_at)
          VALUES (?, ?, ?, 'delivery.replay', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT(id) DO UPDATE SET dispatched_at = NULL, due_at = excluded.due_at, attempts = 0`)
          .bind(outboxId, tenant, deliveryId, JSON.stringify({ deliveryId })),
        audit(database, createId(), tenant, 'delivery.replayed', 'delivery', deliveryId, reason),
      ]);
      return { accepted: true };
    },
    setAdapter: async (tenant, adapter, enabled, reason) => {
      await database.batch([
        database.prepare(`INSERT INTO adapter_controls (tenant_id, adapter, enabled, reason)
          VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, adapter) DO UPDATE SET enabled = excluded.enabled,
          reason = excluded.reason, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
          .bind(tenant, adapter, enabled ? 1 : 0, reason),
        audit(database, createId(), tenant, enabled ? 'adapter.resumed' : 'adapter.paused', 'adapter', adapter, reason),
      ]);
      return { changed: true };
    },
  };
}

function audit(database: Database, id: string, tenant: string, action: string, type: string, target: string, reason: string) {
  return database.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor, action, target_type, target_id, details_json) VALUES (?, ?, 'admin', ?, ?, ?, ?)`)
    .bind(id, tenant, action, type, target, JSON.stringify({ reason }));
}
