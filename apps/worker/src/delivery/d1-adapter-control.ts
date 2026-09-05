interface Statement {
  bind(...values: unknown[]): Statement;
  first(): Promise<unknown>;
}

interface Database {
  prepare(sql: string): Statement;
}

export async function isD1AdapterEnabled(
  database: Database,
  tenantId: string,
  adapter: string,
): Promise<boolean> {
  const value = await database.prepare(`SELECT enabled FROM adapter_controls
    WHERE tenant_id = ? AND adapter = ? LIMIT 1`).bind(tenantId, adapter).first();
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return (value as { enabled?: unknown }).enabled === 1;
}
