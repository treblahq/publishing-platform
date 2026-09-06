import { describe, expect, it } from 'vitest';

import {
  DELIVERY_STATES,
  canTransitionDelivery,
  transitionDelivery,
} from './delivery.js';

describe('delivery state transitions', () => {
  it('allows the verified web path to complete', () => {
    expect(canTransitionDelivery('planned', 'validated')).toBe(true);
    expect(canTransitionDelivery('validated', 'ready')).toBe(true);
    expect(canTransitionDelivery('ready', 'delivering')).toBe(true);
    expect(canTransitionDelivery('delivering', 'delivered')).toBe(true);
    expect(canTransitionDelivery('delivered', 'verified')).toBe(true);
    expect(canTransitionDelivery('verified', 'complete')).toBe(true);
  });

  it('rejects every transition that is not declared', () => {
    for (const from of DELIVERY_STATES) {
      for (const to of DELIVERY_STATES) {
        if (!canTransitionDelivery(from, to)) {
          expect(() => transitionDelivery(from, to)).toThrow(
            `Invalid delivery transition: ${from} -> ${to}`,
          );
        }
      }
    }
  });
});
