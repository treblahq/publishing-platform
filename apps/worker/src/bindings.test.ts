import { describe, expect, it } from 'vitest';

import * as bindings from './bindings.js';

describe('worker bindings', () => {
  it('fails closed when capacity configuration is absent', () => {
    const parseWorkerBindings = Reflect.get(bindings, 'parseWorkerBindings');
    expect(parseWorkerBindings).toBeTypeOf('function');
    expect(() => parseWorkerBindings({})).toThrow('capacity');
  });

  it('accepts all durable bindings with explicit capacity budgets', () => {
    const parseWorkerBindings = Reflect.get(bindings, 'parseWorkerBindings');
    expect(parseWorkerBindings).toBeTypeOf('function');
    const durable = {};
    expect(parseWorkerBindings({
      LEDGER: durable,
      DELIVERY_QUEUE: durable,
      DELIVERY_DLQ: durable,
      ARTIFACTS: durable,
      CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 1000, queueOperations: 1000, r2Bytes: 1000 }),
      ENABLED_ADAPTERS: '',
    })).toMatchObject({ capacity: { d1Rows: 1000, queueOperations: 1000, r2Bytes: 1000 } });
  });
});
