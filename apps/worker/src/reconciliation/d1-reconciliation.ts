interface Statement {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results?: unknown[] }>;
}

interface Database {
  prepare(sql: string): Statement;
}

export interface ReconciliationCandidate {
  tenantId: string;
  deliveryId: string;
}

export async function runD1Reconciliation(
  database: Database,
  limit: number,
  process: (candidate: ReconciliationCandidate) => Promise<void>,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('Reconciliation limit must be between 1 and 100');
  }
  const page = await database.prepare(`SELECT id, tenant_id FROM deliveries
    WHERE state = 'reconciling' ORDER BY updated_at, id LIMIT ?`).bind(limit).all();
  const rows = (page.results ?? []).map(candidateRow);
  for (const candidate of rows) await process(candidate);
  return rows.length;
}

function candidateRow(value: unknown): ReconciliationCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid reconciliation row');
  }
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string') {
    throw new Error('Invalid reconciliation row');
  }
  return { tenantId: row.tenant_id, deliveryId: row.id };
}
