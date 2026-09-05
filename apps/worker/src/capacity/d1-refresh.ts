interface Statement {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results?: unknown[] }>;
  first(): Promise<unknown>;
}

interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export async function refreshD1CapacityUsage(
  database: Database,
  limit: number,
  now: () => Date = () => new Date(),
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('Capacity refresh limit must be between 1 and 100');
  }
  const page = await database.prepare('SELECT id FROM tenants WHERE enabled = 1 ORDER BY id LIMIT ?')
    .bind(limit).all();
  const tenants = (page.results ?? []).map(tenantRow);
  const measuredAt = now().toISOString();
  const windowStart = `${measuredAt.slice(0, 10)}T00:00:00.000Z`;
  for (const tenant of tenants) {
    const storage = await database.prepare(`SELECT COALESCE(SUM(byte_size), 0) AS used FROM (
      SELECT byte_size FROM artifacts
        WHERE tenant_id = ? AND storage IN ('r2-temporary', 'r2-live') AND deleted_at IS NULL
      UNION ALL
      SELECT byte_size FROM artifact_uploads
        WHERE tenant_id = ? AND state = 'available'
    )`)
      .bind(tenant, tenant).first();
    const r2Bytes = usageValue(storage);
    await database.batch([
      refreshStatement(database, tenant, 'd1Rows', windowStart, 0, measuredAt, false),
      refreshStatement(database, tenant, 'queueOperations', windowStart, 0, measuredAt, false),
      refreshStatement(database, tenant, 'r2Bytes', windowStart, r2Bytes, measuredAt, true),
    ]);
  }
  return tenants.length;
}

function refreshStatement(
  database: Database,
  tenant: string,
  resource: string,
  windowStart: string,
  used: number,
  measuredAt: string,
  replaceUsage: boolean,
): Statement {
  return database.prepare(`INSERT INTO capacity_usage
    (tenant_id, resource, window_start, used, measured_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, resource, window_start) DO UPDATE SET
      used = ${replaceUsage ? 'excluded.used' : 'capacity_usage.used'}, measured_at = excluded.measured_at`)
    .bind(tenant, resource, windowStart, used, measuredAt);
}

function tenantRow(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as { id?: unknown }).id !== 'string') {
    throw new Error('Invalid capacity tenant row');
  }
  return (value as { id: string }).id;
}

function usageValue(value: unknown): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid R2 usage row');
  const used = (value as { used?: unknown }).used;
  if (!Number.isSafeInteger(used) || (used as number) < 0) throw new Error('Invalid R2 usage value');
  return used as number;
}
