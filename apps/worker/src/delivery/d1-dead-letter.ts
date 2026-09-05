import type { DeliveryMessage, DeliveryMessageBody } from './queue-handler.js';

interface Statement { bind(...values: unknown[]): Statement }
interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export async function handleD1DeadLetterBatch(
  database: Database,
  messages: readonly DeliveryMessage[],
  createId: () => string = () => crypto.randomUUID(),
): Promise<void> {
  for (const message of messages) {
    const body = parseBody(message.body);
    if (body === undefined) {
      message.ack();
      continue;
    }
    try {
      const fingerprint = `${body.tenantId}:engine:dead-letter`;
      await database.batch([
        database.prepare(`UPDATE deliveries SET state = 'needs_attention', lease_expires_at = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE tenant_id = ? AND id = ?`).bind(body.tenantId, body.deliveryId),
        database.prepare(`INSERT INTO incidents
          (id, tenant_id, fingerprint, category, summary, state)
          VALUES (?, ?, ?, 'dead-letter', 'Delivery exhausted automatic Queue retries', 'open')
          ON CONFLICT(tenant_id, fingerprint) DO UPDATE SET state = 'open',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
          .bind(createId(), body.tenantId, fingerprint),
        database.prepare(`INSERT INTO audit_events
          (id, tenant_id, actor, action, target_type, target_id, details_json)
          VALUES (?, ?, 'worker', 'delivery.dead_lettered', 'delivery', ?, '{}')`)
          .bind(createId(), body.tenantId, body.deliveryId),
      ]);
      message.ack();
    } catch {
      message.retry();
    }
  }
}

function parseBody(value: unknown): DeliveryMessageBody | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  return typeof body.tenantId === 'string' && typeof body.deliveryId === 'string'
    ? { tenantId: body.tenantId, deliveryId: body.deliveryId }
    : undefined;
}
