import type { ArtifactReference, DeliveryReceipt, DeliveryState } from '@trebla/publishing';
import { validatePublicationEnvelope } from '@trebla/publishing';

import type { DeliveryStateStore, DeliveryWork } from './consume.js';

interface Statement {
  bind(...values: unknown[]): Statement;
  first(): Promise<unknown>;
  all(): Promise<{ results?: unknown[] }>;
}

interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<readonly { meta?: { changes?: number } }[]>;
}

interface DeliveryStore extends DeliveryStateStore {
  load(tenantId: string, deliveryId: string): Promise<DeliveryWork | null>;
}

export function createD1DeliveryStore(
  database: Database,
  resolveConfig: (adapter: string, tenantId: string) => unknown,
  createId: () => string = () => crypto.randomUUID(),
): DeliveryStore {
  return {
    load: async (tenantId, deliveryId) => {
      const value = await database.prepare(`
        SELECT delivery.id, delivery.tenant_id, delivery.adapter, delivery.operation, delivery.state,
               delivery.delivery_key, delivery.payload_json, publication.idempotency_key, publication.envelope_json
        FROM deliveries AS delivery
        JOIN publications AS publication ON publication.id = delivery.publication_id
        WHERE delivery.tenant_id = ? AND delivery.id = ? LIMIT 1
      `).bind(tenantId, deliveryId).first();
      const row = deliveryRow(value);
      if (row === undefined) return null;
      const envelope = validatePublicationEnvelope(JSON.parse(row.envelope_json));
      const intent = envelope.deliveries.find((entry) => entry.id === row.delivery_key);
      if (row.tenant_id !== tenantId || envelope.identity.tenant !== tenantId || envelope.identity.idempotencyKey !== row.idempotency_key
        || intent?.adapter !== row.adapter || intent.operation !== row.operation
        || JSON.stringify(intent.payload) !== row.payload_json) throw new Error('Stored delivery does not match approved envelope');
      const artifactPage = await database.prepare(`
        SELECT artifact.id, artifact.storage, artifact.sha256, artifact.byte_size,
               artifact.media_type, artifact.locator
        FROM artifacts AS artifact
        JOIN artifact_references AS reference ON reference.artifact_id = artifact.id
        WHERE reference.tenant_id = ? AND reference.delivery_id = ?
        ORDER BY artifact.id
      `).bind(tenantId, deliveryId).all();
      const storedArtifacts = (artifactPage.results ?? []).map(artifactRow);
      const artifactStorageIds: Record<string, string> = Object.create(null) as Record<string, string>;
      const usedStorageIds = new Set<string>();
      for (const artifact of envelope.artifacts) {
        const matches = storedArtifacts.filter((stored) => stored.storage === artifact.storage && stored.sha256 === artifact.sha256
          && stored.byteSize === artifact.byteSize && stored.mediaType === artifact.mediaType && stored.locator === artifact.locator);
        const matched = matches[0];
        if (matches.length !== 1 || matched === undefined || Object.hasOwn(artifactStorageIds, artifact.id) || usedStorageIds.has(matched.id)) {
          throw new Error('Stored artifacts do not match approved envelope');
        }
        artifactStorageIds[artifact.id] = matched.id;
        usedStorageIds.add(matched.id);
      }
      if (usedStorageIds.size !== storedArtifacts.length) throw new Error('Unexpected stored delivery artifact');
      return {
        tenant: row.tenant_id,
        id: row.id,
        adapter: row.adapter,
        operation: row.operation,
        idempotencyKey: `${row.idempotency_key}:${row.delivery_key}`,
        config: resolveConfig(row.adapter, tenantId),
        payload: parsePayload(row.payload_json),
        ...(intent.providerOptions === undefined ? {} : { providerOptions: intent.providerOptions }),
        artifacts: envelope.artifacts,
        artifactStorageIds,
        state: row.state as DeliveryState,
      };
    },
    commit: async (tenantId, deliveryId, fencingToken, state, receipt, dueAt, safeArtifactIds = []) => {
      const statements = [stateStatement(database, tenantId, deliveryId, fencingToken, state, dueAt)];
      if (receipt !== undefined) {
        statements.push(receiptStatement(database, tenantId, deliveryId, fencingToken, receipt, createId()));
      }
      for (const artifactId of safeArtifactIds) {
        statements.push(safeArtifactStatement(database, tenantId, deliveryId, fencingToken, artifactId));
      }
      const [stateResult] = await database.batch(statements);
      if (stateResult?.meta?.changes !== 1) throw new Error('Cannot commit delivery with stale fencing token');
    },
  };
}

function safeArtifactStatement(database: Database, tenant: string, delivery: string, token: number, artifact: string) {
  return database.prepare(`UPDATE artifact_references SET safe_to_delete = 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE tenant_id = ? AND delivery_id = ? AND artifact_id = ?
      AND EXISTS (SELECT 1 FROM deliveries WHERE tenant_id = ? AND id = ? AND lease_token = ?)`)
    .bind(tenant, delivery, artifact, tenant, delivery, token);
}

function stateStatement(database: Database, tenant: string, id: string, token: number, state: DeliveryState, dueAt?: string) {
  return database.prepare(`UPDATE deliveries SET state = ?, lease_expires_at = NULL,
    due_at = CASE WHEN ? = 'retry_wait' THEN COALESCE(?, datetime('now', '+5 minutes')) ELSE NULL END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE tenant_id = ? AND id = ? AND lease_token = ?`).bind(state, state, dueAt ?? null, tenant, id, token);
}

function receiptStatement(
  database: Database,
  tenant: string,
  delivery: string,
  token: number,
  receipt: DeliveryReceipt,
  id: string,
) {
  return database.prepare(`INSERT OR IGNORE INTO receipts
    (id, tenant_id, delivery_id, provider, remote_id, receipt_json)
    SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM deliveries WHERE tenant_id = ? AND id = ? AND lease_token = ?
    )`)
    .bind(id, tenant, delivery, receipt.provider, receipt.remoteId, JSON.stringify(receipt), tenant, delivery, token);
}

function deliveryRow(value: unknown) {
  if (!record(value)) return undefined;
  for (const key of ['id', 'tenant_id', 'adapter', 'operation', 'state', 'delivery_key', 'idempotency_key', 'payload_json', 'envelope_json']) {
    if (typeof value[key] !== 'string') return undefined;
  }
  return value as unknown as Record<'id' | 'tenant_id' | 'adapter' | 'operation' | 'state' | 'delivery_key' | 'idempotency_key' | 'payload_json' | 'envelope_json', string>;
}

function artifactRow(value: unknown): ArtifactReference {
  if (!record(value)) throw new Error('Invalid delivery artifact row');
  return {
    id: String(value.id), storage: String(value.storage) as ArtifactReference['storage'],
    sha256: String(value.sha256), byteSize: Number(value.byte_size),
    mediaType: String(value.media_type), locator: String(value.locator),
  };
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!record(parsed)) throw new Error('Invalid delivery payload');
  return parsed;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
