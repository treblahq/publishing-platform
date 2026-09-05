import type { PublicationEnvelope } from '@treblahq/publishing-contracts';

import type { AtomicAcceptance, AtomicIntakeStore } from './accept-publication.js';
import { estimateCapacityRequests } from '../capacity/d1-capacity.js';

export interface D1IntakeStatement {
  bind(...values: unknown[]): D1IntakeStatement;
  first<T>(): Promise<T | null>;
}

export interface D1IntakeDatabase {
  prepare(sql: string): D1IntakeStatement;
  batch(statements: D1IntakeStatement[]): Promise<unknown>;
}

export function createD1IntakeStore(
  database: D1IntakeDatabase,
  createId: () => string = () => crypto.randomUUID(),
  now: () => string = () => new Date().toISOString(),
): AtomicIntakeStore {
  return {
    findByIdempotencyKey: async (tenantId, idempotencyKey) => {
      const row = await database.prepare(`
        SELECT id FROM publications WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1
      `).bind(tenantId, idempotencyKey).first<{ id: string }>();
      return row?.id ?? null;
    },
    acceptAtomic: async (acceptance) => {
      const ids = createAcceptanceIds(acceptance.envelope, createId);
      const statements = buildStatements(database, acceptance, ids, now());
      await database.batch(statements);
      return ids.publicationId;
    },
  };
}

interface AcceptanceIds {
  publicationId: string;
  deliveryIds: Map<string, string>;
  artifactIds: Map<string, string>;
}

function createAcceptanceIds(envelope: PublicationEnvelope, createId: () => string): AcceptanceIds {
  return {
    publicationId: createId(),
    deliveryIds: new Map(envelope.deliveries.map((delivery) => [delivery.id, createId()])),
    artifactIds: new Map(envelope.artifacts.map((artifact) => [artifact.id, createId()])),
  };
}

function buildStatements(
  database: D1IntakeDatabase,
  acceptance: AtomicAcceptance,
  ids: AcceptanceIds,
  acceptedAt: string,
): D1IntakeStatement[] {
  const { envelope, principal } = acceptance;
  const expiresAt = new Date(Date.parse(acceptedAt) + 10 * 60 * 1000).toISOString();
  const statements: D1IntakeStatement[] = [
    database.prepare('INSERT INTO nonces (producer_client_id, nonce, expires_at) VALUES (?, ?, ?)')
      .bind(principal.clientId, principal.nonce, expiresAt),
    database.prepare(`INSERT INTO publications
      (id, tenant_id, producer_client_id, source_type, source_id, revision, idempotency_key, envelope_json, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`)
      .bind(ids.publicationId, principal.tenant, principal.clientId, envelope.identity.sourceType,
        envelope.identity.sourceId, envelope.identity.revision, envelope.identity.idempotencyKey,
        JSON.stringify(envelope)),
    database.prepare(`INSERT INTO source_leases
      (tenant_id, source_type, source_id, revision, publication_id) VALUES (?, ?, ?, ?, ?)`)
      .bind(principal.tenant, envelope.identity.sourceType, envelope.identity.sourceId,
        envelope.identity.revision, ids.publicationId),
  ];

  for (const artifact of envelope.artifacts) {
    const artifactId = requireMappedId(ids.artifactIds, artifact.id);
    statements.push(database.prepare(`INSERT INTO artifacts
      (id, tenant_id, storage, sha256, byte_size, media_type, locator, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, '${artifact.storage === 'r2-temporary' ? 'available' : 'staged'}')`)
      .bind(artifactId, principal.tenant, artifact.storage, artifact.sha256, artifact.byteSize,
        artifact.mediaType, artifact.locator));
    if (artifact.storage === 'r2-temporary') {
      statements.push(database.prepare(`UPDATE artifact_uploads SET state = 'claimed', claimed_at = ?,
        updated_at = ? WHERE tenant_id = ? AND locator = ? AND sha256 = ? AND byte_size = ?
        AND media_type = ? AND state IN ('available', 'claimed')`)
        .bind(acceptedAt, acceptedAt, principal.tenant, artifact.locator, artifact.sha256,
          artifact.byteSize, artifact.mediaType));
    }
  }

  for (const delivery of envelope.deliveries) {
    const deliveryId = requireMappedId(ids.deliveryIds, delivery.id);
    statements.push(database.prepare(`INSERT INTO deliveries
      (id, tenant_id, publication_id, delivery_key, adapter, operation, required, payload_json, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')`)
      .bind(deliveryId, principal.tenant, ids.publicationId, delivery.id, delivery.adapter,
        delivery.operation, delivery.required ? 1 : 0, JSON.stringify(delivery.payload)));

    for (const dependency of delivery.dependsOn ?? []) {
      statements.push(database.prepare(`INSERT INTO delivery_dependencies
        (tenant_id, delivery_id, depends_on_delivery_id, required_state) VALUES (?, ?, ?, ?)`)
        .bind(principal.tenant, deliveryId,
          requireMappedId(ids.deliveryIds, dependency.deliveryId), dependency.state));
    }
    for (const artifactId of ids.artifactIds.values()) {
      statements.push(database.prepare(`INSERT INTO artifact_references
        (tenant_id, artifact_id, delivery_id) VALUES (?, ?, ?)`)
        .bind(principal.tenant, artifactId, deliveryId));
    }
    statements.push(database.prepare(`INSERT INTO outbox
      (id, tenant_id, delivery_id, event_type, payload_json, due_at)
      VALUES (?, ?, ?, 'delivery.ready', ?, ?)`)
      .bind(createStableChildId(ids.publicationId, `outbox:${delivery.id}`), principal.tenant,
        deliveryId, JSON.stringify({ deliveryId }), acceptedAt));
  }

  const reservedUntil = new Date(Date.parse(acceptedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const usageWindow = `${acceptedAt.slice(0, 10)}T00:00:00.000Z`;
  const capacity = estimateCapacityRequests(envelope);
  for (const resource of ['d1Rows', 'queueOperations', 'r2Bytes'] as const) {
    const amount = capacity[resource];
    if (amount === 0) continue;
    statements.push(database.prepare(`INSERT INTO capacity_reservations
      (id, tenant_id, publication_id, resource, amount, state, expires_at)
      VALUES (?, ?, ?, ?, ?, 'reserved', ?)`)
      .bind(createStableChildId(ids.publicationId, `capacity:${resource}`), principal.tenant,
        ids.publicationId, resource, amount, reservedUntil));
    statements.push(database.prepare(`INSERT INTO capacity_usage
      (tenant_id, resource, window_start, used, measured_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, resource, window_start) DO UPDATE SET
        used = capacity_usage.used + excluded.used, measured_at = excluded.measured_at`)
      .bind(principal.tenant, resource, usageWindow, amount, acceptedAt));
    statements.push(database.prepare(`UPDATE capacity_reservations SET state = 'consumed', updated_at = ?
      WHERE id = ? AND tenant_id = ? AND state = 'reserved'`)
      .bind(acceptedAt, createStableChildId(ids.publicationId, `capacity:${resource}`), principal.tenant));
  }

  statements.push(database.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor, action, target_type, target_id, details_json)
    VALUES (?, ?, ?, 'publication.accepted', 'publication', ?, ?)`)
    .bind(createStableChildId(ids.publicationId, 'audit:accepted'), principal.tenant,
      principal.clientId, ids.publicationId, JSON.stringify({ nonce: principal.nonce })));
  return statements;
}

function requireMappedId(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing generated ID for ${key}`);
  return value;
}

function createStableChildId(publicationId: string, suffix: string): string {
  return `${publicationId}:${suffix}`;
}
