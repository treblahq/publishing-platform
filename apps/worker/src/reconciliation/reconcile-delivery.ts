import type { ConsumerDependencies, DeliveryWork } from '../delivery/consume.js';
import { validateDeliveryReceipt } from '@trebla/publishing';

export async function reconcileDelivery(
  delivery: DeliveryWork,
  dependencies: ConsumerDependencies,
): Promise<void> {
  const lease = await dependencies.leases.acquire(
    delivery.tenant, delivery.id, dependencies.now(), dependencies.leaseDurationMs ?? 60_000, 'reconciliation',
  );
  if (!lease.acquired) return;
  const fencingToken = lease.token;
  if (delivery.state === 'processing' && delivery.receipt === undefined) {
    await finish('needs_attention');
    return;
  }
  const resolution = dependencies.registry.resolve(delivery.adapter);
  if (resolution.outcome !== 'available' || !resolution.adapter.manifest.capabilities.reconciliation) {
    await finish('needs_attention');
    return;
  }
  try {
    if (delivery.receipt !== undefined) {
      validateDeliveryReceipt(delivery.receipt);
      if (delivery.receipt.provider !== resolution.adapter.manifest.name) throw new Error('Receipt provider mismatch');
    }
    const result = await resolution.adapter.reconcile({
      tenant: delivery.tenant, deliveryId: delivery.id, idempotencyKey: delivery.idempotencyKey,
      operation: delivery.operation, config: delivery.config, payload: delivery.payload,
      ...(delivery.providerOptions === undefined ? {} : { providerOptions: delivery.providerOptions }),
      artifacts: delivery.artifacts, receipt: delivery.receipt,
    });
    if (result.status === 'found') {
      const receipt = validateDeliveryReceipt(result.receipt);
      if (receipt.provider !== resolution.adapter.manifest.name
        || (delivery.receipt !== undefined && receipt.remoteId !== delivery.receipt.remoteId)) {
        throw new Error('Reconciled receipt does not match accepted provider effect');
      }
      const safeArtifactIds: string[] = [];
      if (resolution.adapter.artifactRetention !== undefined) {
        for (const artifact of delivery.artifacts.filter((item) => item.storage === 'r2-temporary')) {
          try {
            const decision = await resolution.adapter.artifactRetention({ tenant: delivery.tenant, deliveryId: delivery.id, artifact, receipt });
            if (decision.safeToDelete) {
              const storageId = delivery.artifactStorageIds === undefined ? artifact.id : delivery.artifactStorageIds[artifact.id];
              if (storageId !== undefined) safeArtifactIds.push(storageId);
            }
          } catch {
            // Retention failures keep bytes without discarding a verified provider effect.
          }
        }
      }
      await finish('verified', receipt, safeArtifactIds);
    }
    else if (result.status === 'absent' && delivery.receipt === undefined && delivery.state !== 'processing') await finish('retry_wait');
    else await finish('reconciling');
  } catch {
    await finish('reconciling');
  }

  async function finish(state: 'verified' | 'retry_wait' | 'reconciling' | 'needs_attention', receipt?: Parameters<ConsumerDependencies['states']['commit']>[4], safeArtifactIds?: readonly string[]) {
    await dependencies.states.commit(delivery.tenant, delivery.id, fencingToken, state, receipt, undefined, safeArtifactIds);
    await dependencies.leases.commit(delivery.tenant, delivery.id, fencingToken);
  }
}
