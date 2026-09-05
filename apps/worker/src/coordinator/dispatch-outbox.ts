export interface DueOutboxRow {
  id: string;
  tenantId: string;
  deliveryId: string;
}

export interface OutboxStore {
  listDue(limit: number): Promise<readonly DueOutboxRow[]>;
  markDispatched(tenantId: string, outboxId: string): Promise<void>;
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
  const rows = await store.listDue(limit);
  let dispatched = 0;
  for (const row of rows) {
    await queue.send(row);
    await store.markDispatched(row.tenantId, row.id);
    dispatched += 1;
  }
  return dispatched;
}
