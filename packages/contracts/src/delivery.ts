export const DELIVERY_STATES = [
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
  'retry_wait',
  'reconciling',
  'failed_terminal',
  'needs_attention',
  'skipped',
  'cancelled',
] as const;

export type DeliveryState = (typeof DELIVERY_STATES)[number];

const TRANSITIONS: Readonly<Record<DeliveryState, readonly DeliveryState[]>> = {
  planned: ['validated', 'failed_terminal', 'skipped', 'cancelled'],
  validated: ['blocked', 'ready', 'failed_terminal', 'skipped', 'cancelled'],
  blocked: ['ready', 'failed_terminal', 'needs_attention', 'cancelled'],
  ready: ['delivering', 'cancelled'],
  delivering: [
    'delivered',
    'processing',
    'verified',
    'retry_wait',
    'reconciling',
    'failed_terminal',
    'needs_attention',
  ],
  delivered: [
    'processing',
    'verified',
    'cleanup_pending',
    'complete',
    'retry_wait',
    'reconciling',
    'failed_terminal',
    'needs_attention',
  ],
  processing: [
    'verified',
    'retry_wait',
    'reconciling',
    'failed_terminal',
    'needs_attention',
  ],
  verified: ['cleanup_pending', 'complete', 'needs_attention'],
  cleanup_pending: ['complete', 'retry_wait', 'needs_attention'],
  complete: [],
  retry_wait: ['ready', 'reconciling', 'failed_terminal', 'needs_attention', 'cancelled'],
  reconciling: [
    'delivered',
    'processing',
    'verified',
    'retry_wait',
    'failed_terminal',
    'needs_attention',
  ],
  failed_terminal: [],
  needs_attention: ['ready', 'reconciling', 'cancelled'],
  skipped: [],
  cancelled: [],
};

export function canTransitionDelivery(from: DeliveryState, to: DeliveryState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transitionDelivery(from: DeliveryState, to: DeliveryState): DeliveryState {
  if (!canTransitionDelivery(from, to)) {
    throw new Error(`Invalid delivery transition: ${from} -> ${to}`);
  }

  return to;
}
