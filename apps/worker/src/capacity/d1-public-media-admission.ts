export interface PublicMediaAdmissionCost {
  d1Reads: number;
  d1Writes: number;
  r2ClassB: number;
}

interface AdmissionDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
    };
  };
}

export function createD1PublicMediaAdmission(
  database: AdmissionDatabase, accountId: string, cost: PublicMediaAdmissionCost, now: () => Date,
): () => Promise<boolean> {
  const allocationCost = copyCost(cost);
  const configured = typeof accountId === 'string' && accountId.length === 32
    && /^[a-f0-9]{32}$/u.test(accountId);
  return async () => {
    if (!configured || !allocationCost) return false;
    try {
      const instant = now();
      if (!(instant instanceof Date)) return false;
      const milliseconds = instant.getTime();
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return false;
      // Reserve the entire vector atomically against an externally provisioned account allocation.
      const result = await database.prepare(`UPDATE public_media_admission_allocations
      SET d1_reads_reserved = d1_reads_reserved + ?,
          d1_writes_reserved = d1_writes_reserved + ?,
          r2_class_b_reserved = r2_class_b_reserved + ?
      WHERE account_id = ? AND enabled = 1
        AND measured_at_ms <= ? AND expires_at_ms > ?
        AND CAST(measured_at_ms / 86400000 AS INTEGER) = ?
        AND d1_reads_limit - d1_reads_reserved >= ?
        AND d1_writes_limit - d1_writes_reserved >= ?
        AND r2_class_b_limit - r2_class_b_reserved >= ?`)
        .bind(allocationCost.d1Reads, allocationCost.d1Writes, allocationCost.r2ClassB,
          accountId, milliseconds, milliseconds, Math.floor(milliseconds / 86_400_000),
          allocationCost.d1Reads, allocationCost.d1Writes, allocationCost.r2ClassB).run();
      return result.success === true && result.meta?.changes === 1;
    } catch {
      // A lost response may have committed: never retry or refund an uncertain reservation.
      return false;
    }
  };
}

function copyCost(value: unknown): PublicMediaAdmissionCost | null {
  if (value === null || typeof value !== 'object') return null;
  const { d1Reads, d1Writes, r2ClassB } = value as Record<string, unknown>;
  return typeof d1Reads === 'number' && Number.isSafeInteger(d1Reads) && d1Reads >= 2
    && typeof d1Writes === 'number' && Number.isSafeInteger(d1Writes) && d1Writes >= 1
    && typeof r2ClassB === 'number' && Number.isSafeInteger(r2ClassB) && r2ClassB >= 2
    ? { d1Reads, d1Writes, r2ClassB } : null;
}
