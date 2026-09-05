import type { OutboxStore } from './dispatch-outbox.js';

interface Statement {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results?: unknown[] }>;
  run(): Promise<unknown>;
}

interface Database {
  prepare(sql: string): Statement;
}

export function createD1OutboxStore(
  database: Database,
  now: () => Date = () => new Date(),
): OutboxStore {
  return {
    listDue: async (limit) => {
      const page = await database.prepare(`
        SELECT id, tenant_id, delivery_id FROM outbox
        WHERE dispatched_at IS NULL AND due_at <= ?
        ORDER BY due_at, id LIMIT ?
      `).bind(now().toISOString(), limit).all();
      return (page.results ?? []).map(toOutboxRow);
    },
    markDispatched: async (tenantId, outboxId) => {
      await database.prepare(`
        UPDATE outbox SET dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), attempts = attempts + 1
        WHERE tenant_id = ? AND id = ? AND dispatched_at IS NULL
      `).bind(tenantId, outboxId).run();
    },
  };
}

function toOutboxRow(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid outbox row');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.delivery_id !== 'string') {
    throw new Error('Invalid outbox row');
  }
  return { id: row.id, tenantId: row.tenant_id, deliveryId: row.delivery_id };
}
