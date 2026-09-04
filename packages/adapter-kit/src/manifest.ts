import { DELIVERY_PAYLOAD_TYPES } from '@treblahq/publishing-contracts';

export interface AdapterManifest {
  readonly contractVersion: 1;
  readonly name: string;
  readonly channels: readonly (typeof DELIVERY_PAYLOAD_TYPES)[number][];
  readonly operations: readonly string[];
  readonly capabilities: {
    readonly providerIdempotency: boolean;
    readonly reconciliation: boolean;
    readonly asynchronousIngestion: boolean;
  };
}

const MANIFEST_KEYS = new Set([
  'contractVersion',
  'name',
  'channels',
  'operations',
  'capabilities',
]);
const CAPABILITY_KEYS = new Set([
  'providerIdempotency',
  'reconciliation',
  'asynchronousIngestion',
]);

export function validateAdapterManifest(value: unknown): AdapterManifest {
  const manifest = requireRecord(value, 'Adapter manifest');
  requireOnlyKeys(manifest, MANIFEST_KEYS, 'Adapter manifest');
  if (manifest.contractVersion !== 1) throw new Error('Unsupported adapter contract version');
  if (typeof manifest.name !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u.test(manifest.name)) {
    throw new Error('Invalid adapter name');
  }
  validateUniqueStrings(manifest.channels, 'channel');
  for (const channel of manifest.channels) {
    if (!DELIVERY_PAYLOAD_TYPES.includes(channel as (typeof DELIVERY_PAYLOAD_TYPES)[number])) {
      throw new Error(`Unsupported adapter channel: ${channel}`);
    }
  }
  validateUniqueStrings(manifest.operations, 'operation');

  const capabilities = requireRecord(manifest.capabilities, 'Adapter capabilities');
  requireOnlyKeys(capabilities, CAPABILITY_KEYS, 'Adapter capabilities');
  for (const key of CAPABILITY_KEYS) {
    if (typeof capabilities[key] !== 'boolean') {
      throw new Error(`Adapter capability ${key} must be boolean`);
    }
  }
  return value as AdapterManifest;
}

function validateUniqueStrings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Adapter ${label}s are required`);
  if (value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`Adapter ${label}s must be non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new Error(`Duplicate adapter ${label}`);
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) throw new Error(`${label} contains unsupported field: ${unsupported}`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
