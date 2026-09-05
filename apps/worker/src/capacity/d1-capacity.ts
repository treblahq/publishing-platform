import type { IntakeCapacity } from '../intake/accept-publication.js';
import type { CapacityBudgets } from '../bindings.js';
import { evaluateCapacity } from './evaluate.js';

interface CapacityStatement {
  bind(...values: unknown[]): CapacityStatement;
  first(): Promise<unknown>;
}

interface CapacityDatabase {
  prepare(sql: string): CapacityStatement;
}

interface UsageRow {
  used: number;
  reserved: number;
  measured_at: string;
}

export function createD1CapacityChecker(
  database: CapacityDatabase,
  budgets: CapacityBudgets,
  now: () => Date = () => new Date(),
) {
  return async (tenant: string, envelope: unknown): Promise<IntakeCapacity> => {
    const requests = estimateCapacityRequests(envelope);
    const currentTime = now();
    for (const resource of ['d1Rows', 'queueOperations', 'r2Bytes'] as const) {
      const value = await database.prepare(`
        SELECT usage.used, usage.measured_at, COALESCE(SUM(reservations.amount), 0) AS reserved
        FROM capacity_usage AS usage
        LEFT JOIN capacity_reservations AS reservations
          ON reservations.tenant_id = usage.tenant_id AND reservations.resource = usage.resource
          AND reservations.state = 'reserved' AND reservations.expires_at > ?
        WHERE usage.tenant_id = ? AND usage.resource = ?
        ORDER BY usage.window_start DESC LIMIT 1
      `).bind(currentTime.toISOString(), tenant, resource).first();
      const row = usageRow(value);
      const decision = evaluateCapacity({
        used: row?.used ?? 0,
        reserved: row?.reserved ?? 0,
        requested: requests[resource],
        internalBudget: budgets[resource],
        measuredAt: row === undefined ? undefined : new Date(row.measured_at),
        now: currentTime,
        maxAgeMs: 60 * 60 * 1_000,
      });
      if (!decision.accepted) return { accepted: false, retryAfter: nextUtcDay(currentTime) };
    }
    return { accepted: true };
  };
}

export function estimateCapacityRequests(value: unknown): CapacityBudgets {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { d1Rows: Number.MAX_SAFE_INTEGER, queueOperations: Number.MAX_SAFE_INTEGER, r2Bytes: Number.MAX_SAFE_INTEGER };
  }
  const envelope = value as { artifacts?: unknown[]; deliveries?: unknown[] };
  const artifacts = Array.isArray(envelope.artifacts) ? envelope.artifacts : [];
  const deliveries = Array.isArray(envelope.deliveries) ? envelope.deliveries : [];
  const r2Bytes = artifacts.reduce<number>((total, artifact) => {
    if (typeof artifact !== 'object' || artifact === null) return total;
    const record = artifact as Record<string, unknown>;
    return record.storage === 'r2-temporary' || record.storage === 'r2-live'
      ? total + (typeof record.byteSize === 'number' ? record.byteSize : Number.MAX_SAFE_INTEGER)
      : total;
  }, 0);
  return {
    d1Rows: 10 + deliveries.length * (3 + artifacts.length) + artifacts.length,
    queueOperations: deliveries.length * 3,
    r2Bytes,
  };
}

function usageRow(value: unknown): UsageRow | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return typeof row.used === 'number' && typeof row.reserved === 'number' && typeof row.measured_at === 'string'
    ? row as unknown as UsageRow
    : undefined;
}

function nextUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}
