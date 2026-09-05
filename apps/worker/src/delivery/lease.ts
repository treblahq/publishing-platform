export type LeaseResult = { acquired: false } | { acquired: true; token: number; expiresAt: string };

export interface DeliveryLeaseStore {
  acquire(
    tenantId: string,
    deliveryId: string,
    now: Date,
    durationMs: number,
  ): LeaseResult | Promise<LeaseResult>;
  commit(
    tenantId: string,
    deliveryId: string,
    fencingToken: number,
  ): void | Promise<void>;
}

export interface MemoryDeliveryLeaseStore {
  acquire(tenantId: string, deliveryId: string, now: Date, durationMs: number): LeaseResult;
  commit(tenantId: string, deliveryId: string, fencingToken: number): void;
}

interface LeaseState {
  token: number;
  expiresAtMs: number;
}

export function createMemoryLeaseStore(): MemoryDeliveryLeaseStore {
  const leases = new Map<string, LeaseState>();
  const tokens = new Map<string, number>();
  return {
    acquire: (tenantId, deliveryId, now, durationMs) => {
      const key = leaseKey(tenantId, deliveryId);
      const current = leases.get(key);
      if (current && current.expiresAtMs > now.getTime()) return { acquired: false };
      const token = (tokens.get(key) ?? 0) + 1;
      const expiresAtMs = now.getTime() + durationMs;
      tokens.set(key, token);
      leases.set(key, { token, expiresAtMs });
      return { acquired: true, token, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    commit: (tenantId, deliveryId, fencingToken) => {
      const key = leaseKey(tenantId, deliveryId);
      if (leases.get(key)?.token !== fencingToken) {
        throw new Error('Cannot commit with stale delivery fencing token');
      }
      leases.delete(key);
    },
  };
}

function leaseKey(tenantId: string, deliveryId: string): string {
  return `${tenantId}:${deliveryId}`;
}
