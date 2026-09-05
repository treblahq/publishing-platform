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
  createId: () => string = () => crypto.randomUUID(),
): OutboxStore {
  return {
    claimDue: async (limit) => {
      const claimedAt = now();
      const claimToken = createId();
      const claimedUntil = new Date(claimedAt.getTime() + 60_000).toISOString();
      const page = await database.prepare(`
        WITH candidates AS (
          SELECT candidate.id FROM outbox AS candidate
          WHERE candidate.dispatched_at IS NULL AND candidate.due_at <= ?
            AND (candidate.claimed_until IS NULL OR candidate.claimed_until <= ?)
          AND NOT EXISTS (
            SELECT 1 FROM delivery_dependencies AS dependency
            JOIN deliveries AS upstream ON upstream.id = dependency.depends_on_delivery_id
            WHERE dependency.delivery_id = candidate.delivery_id
              AND CASE upstream.state
                WHEN 'planned' THEN 0 WHEN 'validated' THEN 1 WHEN 'blocked' THEN 2
                WHEN 'ready' THEN 3 WHEN 'delivering' THEN 4 WHEN 'delivered' THEN 5
                WHEN 'processing' THEN 6 WHEN 'verified' THEN 7
                WHEN 'cleanup_pending' THEN 8 WHEN 'complete' THEN 9 ELSE -1 END
              < CASE dependency.required_state
                WHEN 'planned' THEN 0 WHEN 'validated' THEN 1 WHEN 'blocked' THEN 2
                WHEN 'ready' THEN 3 WHEN 'delivering' THEN 4 WHEN 'delivered' THEN 5
                WHEN 'processing' THEN 6 WHEN 'verified' THEN 7
                WHEN 'cleanup_pending' THEN 8 WHEN 'complete' THEN 9 ELSE 100 END
            )
          ORDER BY candidate.due_at, candidate.id LIMIT ?
        )
        UPDATE outbox SET claim_token = ?, claimed_until = ?
        WHERE id IN (SELECT id FROM candidates)
          AND dispatched_at IS NULL AND (claimed_until IS NULL OR claimed_until <= ?)
        RETURNING id, tenant_id, delivery_id, claim_token
      `).bind(claimedAt.toISOString(), claimedAt.toISOString(), limit, claimToken, claimedUntil, claimedAt.toISOString()).all();
      return (page.results ?? []).map(toOutboxRow);
    },
    markDispatched: async (tenantId, outboxId, claimToken) => {
      await database.prepare(`
        UPDATE outbox SET dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), attempts = attempts + 1,
          claim_token = NULL, claimed_until = NULL
        WHERE tenant_id = ? AND id = ? AND claim_token = ? AND dispatched_at IS NULL
      `).bind(tenantId, outboxId, claimToken).run();
    },
    releaseClaim: async (tenantId, outboxId, claimToken) => {
      await database.prepare(`
        UPDATE outbox SET claim_token = NULL, claimed_until = NULL
        WHERE tenant_id = ? AND id = ? AND claim_token = ? AND dispatched_at IS NULL
      `).bind(tenantId, outboxId, claimToken).run();
    },
  };
}

function toOutboxRow(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid outbox row');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.delivery_id !== 'string'
    || typeof row.claim_token !== 'string') {
    throw new Error('Invalid outbox row');
  }
  return { id: row.id, tenantId: row.tenant_id, deliveryId: row.delivery_id, claimToken: row.claim_token };
}
