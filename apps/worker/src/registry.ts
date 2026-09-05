import type { DeliveryAdapter } from '@trebla/publishing-adapter-kit';

export type AdapterResolution =
  | { outcome: 'unknown' }
  | { outcome: 'disabled' }
  | { outcome: 'available'; adapter: DeliveryAdapter };

export interface AdapterRegistry {
  resolve(name: string): AdapterResolution;
}

export function createAdapterRegistry(
  adapters: readonly DeliveryAdapter[],
  enabledNames: readonly string[],
): AdapterRegistry {
  const compiled = new Map<string, DeliveryAdapter>();
  for (const adapter of adapters) {
    if (compiled.has(adapter.manifest.name)) {
      throw new Error(`Duplicate compiled adapter: ${adapter.manifest.name}`);
    }
    compiled.set(adapter.manifest.name, adapter);
  }
  const enabled = new Set(enabledNames);
  return {
    resolve: (name) => {
      const adapter = compiled.get(name);
      if (!adapter) return { outcome: 'unknown' };
      if (!enabled.has(name)) return { outcome: 'disabled' };
      return { outcome: 'available', adapter };
    },
  };
}
