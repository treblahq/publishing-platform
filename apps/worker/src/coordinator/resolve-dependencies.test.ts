import { describe, expect, it } from 'vitest';

import * as dependencies from './resolve-dependencies.js';

describe('delivery dependency release', () => {
  it('treats complete as satisfying a verified dependency', () => {
    const dependenciesSatisfied = Reflect.get(dependencies, 'dependenciesSatisfied');
    expect(dependenciesSatisfied).toBeTypeOf('function');
    expect(dependenciesSatisfied([{ required: 'verified', current: 'complete' }])).toBe(true);
    expect(dependenciesSatisfied([{ required: 'verified', current: 'delivered' }])).toBe(false);
  });

  it('releases a delivery exactly once', () => {
    const createDependencyCoordinator = Reflect.get(dependencies, 'createDependencyCoordinator');
    expect(createDependencyCoordinator).toBeTypeOf('function');
    const coordinator = createDependencyCoordinator();
    const resolved = [{ required: 'verified', current: 'verified' }] as const;
    expect(coordinator.releaseIfSatisfied('delivery-1', resolved)).toBe(true);
    expect(coordinator.releaseIfSatisfied('delivery-1', resolved)).toBe(false);
  });
});
