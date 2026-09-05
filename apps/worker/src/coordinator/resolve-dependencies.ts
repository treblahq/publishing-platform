import type { DeliveryState } from '@treblahq/publishing-contracts';

export interface ResolvedDependency {
  required: DeliveryState;
  current: DeliveryState;
}

const SUCCESS_ORDER: readonly DeliveryState[] = [
  'planned',
  'validated',
  'blocked',
  'ready',
  'delivering',
  'delivered',
  'processing',
  'verified',
  'cleanup_pending',
  'complete',
];

export function dependenciesSatisfied(dependencies: readonly ResolvedDependency[]): boolean {
  return dependencies.every(({ required, current }) => {
    const requiredIndex = SUCCESS_ORDER.indexOf(required);
    const currentIndex = SUCCESS_ORDER.indexOf(current);
    return requiredIndex >= 0 && currentIndex >= requiredIndex;
  });
}

export function createDependencyCoordinator() {
  const released = new Set<string>();

  return {
    releaseIfSatisfied(deliveryId: string, dependencies: readonly ResolvedDependency[]): boolean {
      if (released.has(deliveryId) || !dependenciesSatisfied(dependencies)) return false;
      released.add(deliveryId);
      return true;
    },
  };
}
