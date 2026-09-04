export interface CapacityBudgets {
  d1Rows: number;
  queueOperations: number;
  r2Bytes: number;
}

export interface WorkerBindings {
  ledger: object;
  deliveryQueue: object;
  deliveryDlq: object;
  artifacts: object;
  capacity: CapacityBudgets;
  enabledAdapters: readonly string[];
}

export function parseWorkerBindings(value: Record<string, unknown>): WorkerBindings {
  const capacity = parseCapacity(value.CAPACITY_BUDGETS);
  return {
    ledger: requireBinding(value.LEDGER, 'LEDGER'),
    deliveryQueue: requireBinding(value.DELIVERY_QUEUE, 'DELIVERY_QUEUE'),
    deliveryDlq: requireBinding(value.DELIVERY_DLQ, 'DELIVERY_DLQ'),
    artifacts: requireBinding(value.ARTIFACTS, 'ARTIFACTS'),
    capacity,
    enabledAdapters: parseEnabledAdapters(value.ENABLED_ADAPTERS),
  };
}

function parseCapacity(value: unknown): CapacityBudgets {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Worker capacity configuration is required');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Worker capacity configuration must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Worker capacity configuration must be an object');
  }
  const record = parsed as Record<string, unknown>;
  for (const key of ['d1Rows', 'queueOperations', 'r2Bytes']) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) <= 0) {
      throw new Error(`Worker capacity budget ${key} must be a positive integer`);
    }
  }
  return record as unknown as CapacityBudgets;
}

function requireBinding(value: unknown, name: string): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Worker binding ${name} is required`);
  }
  return value;
}

function parseEnabledAdapters(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new Error('Worker enabled adapter list is required');
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
