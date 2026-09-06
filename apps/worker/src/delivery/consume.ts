import type { ArtifactReference, DeliveryReceipt, DeliveryState } from '@trebla/publishing';
import { DeliveryError, validateDeliveryReceipt } from '@trebla/publishing';
import { DELIVERY_PAYLOAD_TYPES } from '@trebla/publishing';
import { assertAdapterSupports } from '@trebla/publishing-adapter-kit';

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
  state?: DeliveryState;
}

export interface DeliveryStateStore {
  commit(
    tenantId: string,
    deliveryId: string,
    fencingToken: number,
    state: DeliveryState,
    receipt?: DeliveryReceipt,
    dueAt?: string,
    safeArtifactIds?: readonly string[],
  ): Promise<void>;
}

export interface ConsumerDependencies {
  registry: AdapterRegistry;
  leases: DeliveryLeaseStore;
  states: DeliveryStateStore;
  now(): Date;
  leaseDurationMs?: number;
  attempts?: DeliveryAttemptStore;
  failures?: {
    record(tenant: string, adapter: string, category: string, code: string): Promise<void>;
  };
}

export async function consumeDelivery(
  delivery: DeliveryWork,
  dependencies: ConsumerDependencies,
): Promise<void> {
  if (delivery.state !== undefined && !['planned', 'validated', 'ready', 'delivering'].includes(delivery.state)) {
    return;
  }
  const lease = await dependencies.leases.acquire(
    delivery.tenant,
    delivery.id,
    dependencies.now(),
    dependencies.leaseDurationMs ?? 60_000,
    'delivery',
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
    const channel = delivery.payload.type;
    if (typeof channel !== 'string' || !DELIVERY_PAYLOAD_TYPES.includes(channel as (typeof DELIVERY_PAYLOAD_TYPES)[number])) {
      throw new DeliveryError({ code: 'ADAPTER_UNSUPPORTED_CHANNEL', category: 'terminal', message: 'Unsupported delivery channel' });
    }
    try {
      assertAdapterSupports(resolution.adapter.manifest, channel as (typeof DELIVERY_PAYLOAD_TYPES)[number], delivery.operation);
    } catch {
      throw new DeliveryError({ code: 'ADAPTER_UNSUPPORTED_INTENT', category: 'terminal', message: 'Adapter does not support the requested intent' });
    }
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
    const safeArtifactIds: string[] = [];
    if (resolution.adapter.artifactRetention !== undefined) {
      for (const artifact of delivery.artifacts.filter((item) => item.storage === 'r2-temporary')) {
        try {
          const decision = await resolution.adapter.artifactRetention({
            tenant: delivery.tenant, deliveryId: delivery.id, artifact, receipt,
          });
          if (decision.safeToDelete) safeArtifactIds.push(artifact.id);
        } catch {
          // A failed retention check keeps bytes safely retained without undoing a verified provider effect.
        }
      }
    }
    await commit(dependencies, delivery, lease.token, state, receipt, undefined, safeArtifactIds);
  } catch (error) {
    if (attemptId !== undefined) {
      const details = error instanceof DeliveryError
        ? { category: error.category, code: error.code }
        : { category: 'internal', code: 'UNCLASSIFIED' };
      await dependencies.attempts?.finish(delivery.tenant, attemptId, details.category, details.code);
    }
    if (error instanceof DeliveryError && error.category === 'credential') {
      await dependencies.failures?.record(delivery.tenant, delivery.adapter, error.category, error.code);
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
  safeArtifactIds?: readonly string[],
): Promise<void> {
  await dependencies.states.commit(delivery.tenant, delivery.id, token, state, receipt, dueAt, safeArtifactIds);
  await dependencies.leases.commit(delivery.tenant, delivery.id, token);
}
