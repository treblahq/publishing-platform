import { validateArtifactReference, type ArtifactReference } from './artifact.js';
import { DELIVERY_STATES, type DeliveryState } from './delivery.js';

export interface DeliveryDependency {
  deliveryId: string;
  state: DeliveryState;
}

export interface DeliveryIntent {
  id: string;
  adapter: string;
  operation: string;
  required: boolean;
  dependsOn?: DeliveryDependency[];
  payload: Record<string, unknown> & { type: string };
  providerOptions?: Record<string, unknown>;
}

export const DELIVERY_PAYLOAD_TYPES = [
  'web.page',
  'push.notification',
  'social.post',
  'video.upload',
] as const;

export const MAX_ENVELOPE_BYTES = 256 * 1024;

export interface PublicationEnvelope {
  schemaVersion: 1;
  identity: {
    tenant: string;
    sourceType: string;
    sourceId: string;
    revision: string;
    idempotencyKey: string;
  };
  canonical: {
    title: string;
    summary?: string;
    canonicalUrl?: string;
    language: string;
  };
  artifacts: ArtifactReference[];
  deliveries: DeliveryIntent[];
}

const ROOT_KEYS = new Set([
  'schemaVersion',
  'identity',
  'canonical',
  'artifacts',
  'deliveries',
]);
const IDENTITY_KEYS = new Set([
  'tenant',
  'sourceType',
  'sourceId',
  'revision',
  'idempotencyKey',
]);
const CANONICAL_KEYS = new Set(['title', 'summary', 'canonicalUrl', 'language']);
const DELIVERY_KEYS = new Set([
  'id',
  'adapter',
  'operation',
  'required',
  'dependsOn',
  'payload',
  'providerOptions',
]);
const SECRET_KEY = /(?:authorization|credential|password|secret|token)/iu;

export function validatePublicationEnvelope(value: unknown): PublicationEnvelope {
  rejectNonDataOrSecretFields(value);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_ENVELOPE_BYTES) {
    throw new Error('Publication envelope is too large');
  }
  const root = requireRecord(value, 'Publication envelope');
  requireOnlyKeys(root, ROOT_KEYS, 'Publication envelope');

  if (root.schemaVersion !== 1) {
    throw new Error('Unsupported publication envelope schema version');
  }

  validateIdentity(root.identity);
  validateCanonical(root.canonical);

  if (!Array.isArray(root.artifacts)) {
    throw new Error('Publication artifacts must be an array');
  }
  root.artifacts.forEach(validateArtifactReference);

  if (!Array.isArray(root.deliveries) || root.deliveries.length === 0) {
    throw new Error('Publication must include at least one delivery');
  }

  const deliveries = root.deliveries.map(validateDelivery);
  validateDependencies(deliveries);
  return value as PublicationEnvelope;
}

function validateIdentity(value: unknown): void {
  const identity = requireRecord(value, 'Publication identity');
  requireOnlyKeys(identity, IDENTITY_KEYS, 'Publication identity');
  for (const key of IDENTITY_KEYS) {
    requireNonEmptyString(identity[key], `Publication identity ${key}`);
  }
}

function validateCanonical(value: unknown): void {
  const canonical = requireRecord(value, 'Canonical content');
  requireOnlyKeys(canonical, CANONICAL_KEYS, 'Canonical content');
  requireNonEmptyString(canonical.title, 'Canonical title');
  requireNonEmptyString(canonical.language, 'Canonical language');
  optionalString(canonical.summary, 'Canonical summary');
  optionalUrl(canonical.canonicalUrl, 'Canonical URL');
}

function validateDelivery(value: unknown): DeliveryIntent {
  const delivery = requireRecord(value, 'Delivery intent');
  requireOnlyKeys(delivery, DELIVERY_KEYS, 'Delivery intent');
  requireNonEmptyString(delivery.id, 'Delivery ID');
  requireNonEmptyString(delivery.adapter, 'Delivery adapter');
  requireNonEmptyString(delivery.operation, 'Delivery operation');
  if (typeof delivery.required !== 'boolean') {
    throw new Error('Delivery required must be boolean');
  }
  const payload = requireRecord(delivery.payload, 'Delivery payload');
  requireNonEmptyString(payload.type, 'Delivery payload type');
  validatePayload(payload);

  if (delivery.providerOptions !== undefined) {
    requireRecord(delivery.providerOptions, 'Provider options');
  }

  if (delivery.dependsOn !== undefined) {
    if (!Array.isArray(delivery.dependsOn)) {
      throw new Error('Delivery dependencies must be an array');
    }
    for (const dependencyValue of delivery.dependsOn) {
      const dependency = requireRecord(dependencyValue, 'Delivery dependency');
      requireOnlyKeys(dependency, new Set(['deliveryId', 'state']), 'Delivery dependency');
      requireNonEmptyString(dependency.deliveryId, 'Dependency delivery ID');
      if (!DELIVERY_STATES.includes(dependency.state as DeliveryState)) {
        throw new Error('Invalid dependency state');
      }
    }
  }

  return value as DeliveryIntent;
}

function validatePayload(payload: Record<string, unknown>): void {
  if (!DELIVERY_PAYLOAD_TYPES.includes(payload.type as (typeof DELIVERY_PAYLOAD_TYPES)[number])) {
    throw new Error(`Unsupported delivery payload type: ${String(payload.type)}`);
  }

  switch (payload.type) {
    case 'web.page':
      requireNonEmptyString(payload.route, 'Web page route');
      if (!payload.route.startsWith('/')) throw new Error('Web page route must be absolute');
      break;
    case 'push.notification': {
      const audience = requireRecord(payload.audience, 'Push audience');
      if (audience.type !== 'all-subscribers') throw new Error('Unsupported push audience');
      requireNonEmptyString(payload.title, 'Push title');
      requireNonEmptyString(payload.body, 'Push body');
      optionalUrl(payload.url, 'Push URL');
      break;
    }
    case 'social.post':
      requireNonEmptyString(payload.text, 'Social post text');
      break;
    case 'video.upload':
      requireNonEmptyString(payload.artifactId, 'Video artifact ID');
      requireNonEmptyString(payload.title, 'Video title');
      break;
  }
}

function validateDependencies(deliveries: DeliveryIntent[]): void {
  const byId = new Map<string, DeliveryIntent>();
  for (const delivery of deliveries) {
    if (byId.has(delivery.id)) {
      throw new Error(`Duplicate delivery ID: ${delivery.id}`);
    }
    byId.set(delivery.id, delivery);
  }

  for (const delivery of deliveries) {
    for (const dependency of delivery.dependsOn ?? []) {
      if (!byId.has(dependency.deliveryId)) {
        throw new Error(`Unknown delivery dependency: ${dependency.deliveryId}`);
      }
      if (dependency.deliveryId === delivery.id) {
        throw new Error(`Delivery cannot depend on itself: ${delivery.id}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (deliveryId: string): void => {
    if (visiting.has(deliveryId)) {
      throw new Error('Delivery dependency cycle');
    }
    if (visited.has(deliveryId)) return;
    visiting.add(deliveryId);
    for (const dependency of byId.get(deliveryId)?.dependsOn ?? []) {
      visit(dependency.deliveryId);
    }
    visiting.delete(deliveryId);
    visited.add(deliveryId);
  };
  deliveries.forEach((delivery) => {
    visit(delivery.id);
  });
}

function rejectNonDataOrSecretFields(value: unknown): void {
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new Error('Publication envelope must contain JSON data only');
  }
  if (Array.isArray(value)) {
    value.forEach(rejectNonDataOrSecretFields);
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        throw new Error(`Secret-like field is forbidden: ${key}`);
      }
      rejectNonDataOrSecretFields(child);
    }
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) throw new Error(`${label} contains unsupported field: ${unsupported}`);
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string`);
}

function optionalUrl(value: unknown, label: string): void {
  optionalString(value, label);
  if (typeof value === 'string' && !URL.canParse(value)) throw new Error(`${label} must be valid`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
