import type { DeliveryState } from '@treblahq/publishing-contracts';

interface AmbiguousRecovery {
  providerIdempotency: boolean;
  reconciliation: boolean;
  reconcile: (() => Promise<{ status: 'found' | 'absent' | 'unknown' }>) | undefined;
}

export interface ReconciliationDecision {
  state: DeliveryState;
  reason: 'effect-found' | 'absence-established' | 'provider-idempotency' | 'duplicate-risk';
}

export async function reconcileAmbiguous(
  recovery: AmbiguousRecovery,
): Promise<ReconciliationDecision> {
  if (recovery.reconciliation && recovery.reconcile !== undefined) {
    const result = await recovery.reconcile();
    if (result.status === 'found') return { state: 'verified', reason: 'effect-found' };
    if (result.status === 'absent') return { state: 'retry_wait', reason: 'absence-established' };
  }
  if (recovery.providerIdempotency) {
    return { state: 'retry_wait', reason: 'provider-idempotency' };
  }
  return { state: 'needs_attention', reason: 'duplicate-risk' };
}

export async function runBoundedReconciliation<T extends string>(
  candidates: readonly T[],
  batchSize: number,
  process: (candidate: T) => Promise<void>,
): Promise<{ processed: number; cursor: T | undefined; hasMore: boolean }> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('Reconciliation batch size must be a positive integer');
  }
  const batch = candidates.slice(0, batchSize);
  for (const candidate of batch) await process(candidate);
  return {
    processed: batch.length,
    cursor: batch.at(-1),
    hasMore: candidates.length > batch.length,
  };
}
