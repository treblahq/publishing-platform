import type { ArtifactReference, DeliveryReceipt, DeliveryState } from '@treblahq/publishing-contracts';
import { DeliveryError, validateDeliveryReceipt } from '@treblahq/publishing-contracts';

import type { AdapterRegistry } from '../registry.js';
import type { DeliveryLeaseStore } from './lease.js';
import type { DeliveryAttemptStore } from './d1-attempt-store.js';

export interface DeliveryWork {
  tenant: string;
  id: string;
  adapter: string;
  operation: string;
  idempotencyKey: string;
  config: unknown;
  payload: Record<string, unknown>;
  artifacts: readonly ArtifactReference[];
}

export interface DeliveryStateStore {
  commit(
    tenantId: string,
    deliveryId: string,
    fencingToken: number,
    state: DeliveryState,
    receipt?: DeliveryReceipt,
    dueAt?: string,
  ): Promise<void>;
}

export interface ConsumerDependencies {
  registry: AdapterRegistry;
  leases: DeliveryLeaseStore;
  states: DeliveryStateStore;
  now(): Date;
  leaseDurationMs?: number;
  attempts?: DeliveryAttemptStore;
}

export async function consumeDelivery(
  delivery: DeliveryWork,
  dependencies: ConsumerDependencies,
): Promise<void> {
  const lease = await dependencies.leases.acquire(
    delivery.tenant,
    delivery.id,
    dependencies.now(),
    dependencies.leaseDurationMs ?? 60_000,
  );
  if (!lease.acquired) return;

  const resolution = dependencies.registry.resolve(delivery.adapter);
  if (resolution.outcome !== 'available') {
    await commit(dependencies, delivery, lease.token, 'needs_attention');
    return;
  }

  const context = {
    tenant: delivery.tenant,
    deliveryId: delivery.id,
    idempotencyKey: delivery.idempotencyKey,
    operation: delivery.operation,
    config: delivery.config,
    payload: delivery.payload,
    artifacts: delivery.artifacts,
  };
  const attemptId = await dependencies.attempts?.start(delivery.tenant, delivery.id, lease.token);

  try {
    const validation = await resolution.adapter.validate(context);
    if (!validation.valid) {
      await commit(dependencies, delivery, lease.token, 'failed_terminal');
      return;
    }
    const receipt = validateDeliveryReceipt(await resolution.adapter.deliver(context));
    const state = resolution.adapter.manifest.capabilities.asynchronousIngestion
      ? 'processing'
      : 'verified';
    if (attemptId !== undefined) await dependencies.attempts?.finish(delivery.tenant, attemptId);
    await commit(dependencies, delivery, lease.token, state, receipt);
  } catch (error) {
    if (attemptId !== undefined) {
      const details = error instanceof DeliveryError
        ? { category: error.category, code: error.code }
        : { category: 'internal', code: 'UNCLASSIFIED' };
      await dependencies.attempts?.finish(delivery.tenant, attemptId, details.category, details.code);
    }
    const failure = classifyFailure(error, resolution.adapter.manifest.capabilities, dependencies.now());
    await commit(dependencies, delivery, lease.token, failure.state, undefined, failure.dueAt);
  }
}

function classifyFailure(
  error: unknown,
  capabilities: { reconciliation: boolean; providerIdempotency: boolean },
  now: Date,
): { state: DeliveryState; dueAt?: string } {
  if (!(error instanceof DeliveryError)) return { state: 'needs_attention' };
  switch (error.category) {
    case 'retryable':
      return { state: 'retry_wait' };
    case 'rate-limited':
      return { state: 'retry_wait', ...retryDate(error.retryAfter, now) };
    case 'ambiguous':
      if (capabilities.reconciliation) return { state: 'reconciling' };
      return { state: capabilities.providerIdempotency ? 'retry_wait' : 'needs_attention' };
    case 'credential':
      return { state: 'needs_attention' };
    case 'terminal':
      return { state: 'failed_terminal' };
  }
}

function retryDate(value: string | undefined, now: Date): { dueAt?: string } {
  if (value === undefined) return {};
  const seconds = /^\d+$/u.test(value) ? Number(value) : undefined;
  const timestamp = seconds === undefined ? Date.parse(value) : now.getTime() + seconds * 1_000;
  return Number.isFinite(timestamp) && timestamp > now.getTime()
    ? { dueAt: new Date(timestamp).toISOString() }
    : {};
}

async function commit(
  dependencies: ConsumerDependencies,
  delivery: DeliveryWork,
  token: number,
  state: DeliveryState,
  receipt?: DeliveryReceipt,
  dueAt?: string,
): Promise<void> {
  await dependencies.states.commit(delivery.tenant, delivery.id, token, state, receipt, dueAt);
  await dependencies.leases.commit(delivery.tenant, delivery.id, token);
}
