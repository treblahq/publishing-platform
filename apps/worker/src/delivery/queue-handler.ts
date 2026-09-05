export interface DeliveryMessage {
  body: unknown;
  ack(): void;
  retry(): void;
}

export interface DeliveryMessageBody {
  tenantId: string;
  deliveryId: string;
}

export async function handleDeliveryBatch(
  messages: readonly DeliveryMessage[],
  process: (message: DeliveryMessageBody) => Promise<void>,
): Promise<void> {
  for (const message of messages) {
    const body = parseBody(message.body);
    if (body === undefined) {
      message.retry();
      continue;
    }
    try {
      await process(body);
      message.ack();
    } catch {
      message.retry();
    }
  }
}

function parseBody(value: unknown): DeliveryMessageBody | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  return typeof body.tenantId === 'string' && typeof body.deliveryId === 'string'
    ? { tenantId: body.tenantId, deliveryId: body.deliveryId }
    : undefined;
}
