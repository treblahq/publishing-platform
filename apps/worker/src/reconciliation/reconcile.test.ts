import { describe, expect, it, vi } from 'vitest';

import { reconcileAmbiguous, runBoundedReconciliation } from './reconcile.js';

describe('ambiguous delivery reconciliation', () => {
  it('uses provider reconciliation before retrying', async () => {
    const reconcile = vi.fn().mockResolvedValue({ status: 'absent' });
    await expect(reconcileAmbiguous({
      providerIdempotency: false,
      reconciliation: true,
      reconcile,
    })).resolves.toEqual({ state: 'retry_wait', reason: 'absence-established' });
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('permits identical retry only when the provider enforces idempotency', async () => {
    await expect(reconcileAmbiguous({
      providerIdempotency: true,
      reconciliation: false,
      reconcile: undefined,
    })).resolves.toEqual({ state: 'retry_wait', reason: 'provider-idempotency' });
  });

  it('requires attention if absence cannot be established safely', async () => {
    await expect(reconcileAmbiguous({
      providerIdempotency: false,
      reconciliation: false,
      reconcile: undefined,
    })).resolves.toEqual({ state: 'needs_attention', reason: 'duplicate-risk' });
  });

  it('accepts a found provider effect without another write', async () => {
    await expect(reconcileAmbiguous({
      providerIdempotency: false,
      reconciliation: true,
      reconcile: () => Promise.resolve({ status: 'found' }),
    })).resolves.toEqual({ state: 'verified', reason: 'effect-found' });
  });
});

describe('bounded reconciliation collector', () => {
  it('never processes beyond the requested batch size', async () => {
    const processed: string[] = [];
    const result = await runBoundedReconciliation(['a', 'b', 'c'], 2, (id) => {
      processed.push(id);
      return Promise.resolve();
    });
    expect(processed).toEqual(['a', 'b']);
    expect(result).toEqual({ processed: 2, cursor: 'b', hasMore: true });
  });
});
