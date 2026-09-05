import type { LeaseResult } from './lease.js';

interface D1LeaseStatement {
  bind(...values: unknown[]): D1LeaseStatement;
  first<T>(): Promise<T | null>;
}

interface D1LeaseDatabase {
  prepare(sql: string): D1LeaseStatement;
}

export async function acquireD1Lease(
  database: D1LeaseDatabase,
  tenantId: string,
  deliveryId: string,
  now: Date,
  durationMs: number,
  purpose: 'delivery' | 'reconciliation' = 'delivery',
): Promise<LeaseResult> {
  const expiresAt = new Date(now.getTime() + durationMs).toISOString();
  const eligibleStates = purpose === 'reconciliation'
    ? "state = 'reconciling'"
    : "state IN ('planned','validated','ready','delivering')";
  const row = await database.prepare(`
    UPDATE deliveries
    SET lease_token = lease_token + 1, lease_expires_at = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ?
      AND ${eligibleStates}
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    RETURNING lease_token
  `).bind(expiresAt, now.toISOString(), tenantId, deliveryId, now.toISOString())
    .first<{ lease_token: number }>();
  return row
    ? { acquired: true, token: row.lease_token, expiresAt }
    : { acquired: false };
}
