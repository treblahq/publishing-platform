interface Statement {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results?: unknown[] }>;
}
interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export async function enqueueDueRetries(
  database: Database,
  limit: number,
  now: () => Date = () => new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) throw new Error('Retry limit must be between 1 and 100');
  const page = await database.prepare(`SELECT id, tenant_id FROM deliveries
    WHERE state = 'retry_wait' AND due_at <= ? ORDER BY due_at, id LIMIT ?`)
    .bind(now().toISOString(), limit).all();
  const rows = (page.results ?? []).map(retryRow);
  for (const row of rows) {
    await database.batch([
      database.prepare(`UPDATE deliveries SET state = 'ready', due_at = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE tenant_id = ? AND id = ? AND state = 'retry_wait'`).bind(row.tenantId, row.id),
      database.prepare(`INSERT INTO outbox (id, tenant_id, delivery_id, event_type, payload_json, due_at)
        VALUES (?, ?, ?, 'delivery.retry', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ON CONFLICT(id) DO UPDATE SET dispatched_at = NULL, due_at = excluded.due_at, attempts = 0`)
        .bind(`retry:${row.tenantId}:${row.id}`, row.tenantId, row.id, JSON.stringify({ deliveryId: row.id })),
    ]);
  }
  return rows.length;
}

function retryRow(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid retry row');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string') throw new Error('Invalid retry row');
  return { id: row.id, tenantId: row.tenant_id };
}
