export const WEB_ENTITY_KINDS = ['job', 'author', 'community'] as const;
export const WEB_ENTITY_STATUSES = ['active', 'closed'] as const;
export const MAX_WEB_ENTITY_BYTES = 256 * 1024;

export type WebEntityKind = (typeof WEB_ENTITY_KINDS)[number];
export type WebEntityStatus = (typeof WEB_ENTITY_STATUSES)[number];

export interface WebEntityRevision {
  schemaVersion: 1;
  tenant: string;
  kind: WebEntityKind;
  id: string;
  revision: string;
  canonicalPath: string;
  title: string;
  summary?: string;
  status: WebEntityStatus;
  contentSha256: string;
  content: Record<string, unknown>;
}

const ROOT_KEYS = new Set([
  'schemaVersion',
  'tenant',
  'kind',
  'id',
  'revision',
  'canonicalPath',
  'title',
  'summary',
  'status',
  'contentSha256',
  'content',
]);
const SECRET_KEY = /(?:authorization|credential|password|secret|token)/iu;

export function validateWebEntityRevision(value: unknown): WebEntityRevision {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_WEB_ENTITY_BYTES) throw new Error('Web entity revision is too large');

  const entity = requireRecord(value, 'Web entity revision');
  requireOnlyKeys(entity, ROOT_KEYS);
  rejectSecretFields(entity);

  if (entity.schemaVersion !== 1) throw new Error('Unsupported web entity schema version');
  requireNonEmptyString(entity.tenant, 'tenant');
  requireNonEmptyString(entity.id, 'id');
  requireNonEmptyString(entity.revision, 'revision');
  requireNonEmptyString(entity.title, 'title');
  if (entity.summary !== undefined) requireNonEmptyString(entity.summary, 'summary');
  if (!WEB_ENTITY_KINDS.includes(entity.kind as WebEntityKind)) {
    throw new Error('Invalid web entity kind');
  }
  if (!WEB_ENTITY_STATUSES.includes(entity.status as WebEntityStatus)) {
    throw new Error('Invalid web entity status');
  }
  if (typeof entity.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entity.contentSha256)) {
    throw new Error('Invalid web entity content hash');
  }
  requireRecord(entity.content, 'Web entity content');

  const expectedPath = canonicalPath(entity.kind as WebEntityKind, entity.id);
  if (entity.canonicalPath !== expectedPath) {
    throw new Error('Invalid web entity canonical path');
  }

  return value as WebEntityRevision;
}

function canonicalPath(kind: WebEntityKind, id: string): string {
  if (kind === 'job') return `/jobs/${encodeURIComponent(id)}`;
  if (kind === 'author') return `/authors/${encodeURIComponent(id)}`;
  const [owner, name, ...rest] = id.split('/');
  if (!owner || !name || rest.length > 0) return '';
  return `/communities/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function rejectSecretFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectSecretFields);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new Error(`Secret-like field is forbidden: ${key}`);
    rejectSecretFields(nested);
  }
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported !== undefined) throw new Error(`Web entity contains unsupported field: ${unsupported}`);
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Web entity ${label} must be a non-empty string`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
