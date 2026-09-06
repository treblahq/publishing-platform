export interface DeliveryReceipt {
  provider: string;
  remoteId: string;
  acceptedAt: string;
  remoteUrl?: string;
  metadata?: Record<string, unknown>;
}

const RECEIPT_KEYS = new Set(['provider', 'remoteId', 'acceptedAt', 'remoteUrl', 'metadata']);
const SECRET_KEY = /(?:authorization|credential|password|secret|token)/iu;

export function validateDeliveryReceipt(value: unknown): DeliveryReceipt {
  const receipt = requireRecord(value, 'Delivery receipt');
  const unsupported = Object.keys(receipt).find((key) => !RECEIPT_KEYS.has(key));
  if (unsupported !== undefined) throw new Error(`Unsupported receipt field: ${unsupported}`);

  requireText(receipt.provider, 'Receipt provider');
  requireText(receipt.remoteId, 'Receipt remote ID');
  requireIsoDate(receipt.acceptedAt);

  if (receipt.remoteUrl !== undefined) {
    requireText(receipt.remoteUrl, 'Receipt remote URL');
    const url = new URL(receipt.remoteUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Receipt remote URL must use HTTP');
    }
  }

  if (receipt.metadata !== undefined) {
    requireRecord(receipt.metadata, 'Receipt metadata');
    rejectSecretMetadata(receipt.metadata);
  }

  return value as DeliveryReceipt;
}

function requireIsoDate(value: unknown): void {
  requireText(value, 'Receipt acceptance time');
  if (new Date(value).toISOString() !== value) {
    throw new Error('Receipt acceptance time must be an ISO timestamp');
  }
}

function rejectSecretMetadata(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectSecretMetadata);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Secret receipt metadata is forbidden: ${key}`);
    rejectSecretMetadata(child);
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
