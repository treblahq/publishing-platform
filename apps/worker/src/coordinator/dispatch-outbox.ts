export interface DueOutboxRow {
  id: string;
  tenantId: string;
  deliveryId: string;
  claimToken: string;
}

export interface OutboxStore {
  claimDue(limit: number): Promise<readonly DueOutboxRow[]>;
  markDispatched(tenantId: string, outboxId: string, claimToken: string): Promise<void>;
  releaseClaim(tenantId: string, outboxId: string, claimToken: string): Promise<void>;
}

export interface DeliveryQueue {
  send(message: DueOutboxRow): Promise<void>;
}

export async function dispatchOutbox(
  store: OutboxStore,
  queue: DeliveryQueue,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
    throw new Error('Outbox dispatch limit must be between 1 and 100');
  }
  const rows = await store.claimDue(limit);
  let dispatched = 0;
  for (const [index, row] of rows.entries()) {
    try {
      await queue.send(row);
      await store.markDispatched(row.tenantId, row.id, row.claimToken);
      dispatched += 1;
    } catch (error) {
      await Promise.all(rows.slice(index).map((pending) => store.releaseClaim(
        pending.tenantId, pending.id, pending.claimToken,
      )));
      throw error;
    }
  }
  return dispatched;
}
