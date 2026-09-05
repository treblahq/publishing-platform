import type { ConsumerDependencies, DeliveryWork } from '../delivery/consume.js';

export async function reconcileDelivery(
  delivery: DeliveryWork,
  dependencies: ConsumerDependencies,
): Promise<void> {
  const lease = await dependencies.leases.acquire(
    delivery.tenant, delivery.id, dependencies.now(), dependencies.leaseDurationMs ?? 60_000, 'reconciliation',
  );
  if (!lease.acquired) return;
  const fencingToken = lease.token;
  const resolution = dependencies.registry.resolve(delivery.adapter);
  if (resolution.outcome !== 'available' || !resolution.adapter.manifest.capabilities.reconciliation) {
    await finish('needs_attention');
    return;
  }
  try {
    const result = await resolution.adapter.reconcile({
      tenant: delivery.tenant, deliveryId: delivery.id, idempotencyKey: delivery.idempotencyKey,
      operation: delivery.operation, config: delivery.config, payload: delivery.payload,
      artifacts: delivery.artifacts, receipt: undefined,
    });
    if (result.status === 'found') await finish('verified', result.receipt);
    else if (result.status === 'absent') await finish('retry_wait');
    else await finish('reconciling');
  } catch {
    await finish('reconciling');
  }

  async function finish(state: 'verified' | 'retry_wait' | 'reconciling' | 'needs_attention', receipt?: Parameters<ConsumerDependencies['states']['commit']>[4]) {
    await dependencies.states.commit(delivery.tenant, delivery.id, fencingToken, state, receipt);
    await dependencies.leases.commit(delivery.tenant, delivery.id, fencingToken);
  }
}
