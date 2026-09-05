interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export interface UploadReservationRequest {
  tenant: string;
  clientId: string;
  nonce: string;
  locator: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  now: Date;
}

export type UploadReservation =
  | { outcome: 'reserved'; uploadId: string }
  | { outcome: 'already-available'; uploadId: string }
  | { outcome: 'in-progress'; uploadId: string }
  | { outcome: 'conflict' };

interface UploadRow {
  id: string;
  sha256: string;
  byte_size: number;
  media_type: string;
  state: string;
  expires_at: string;
  capacity_reservation_id?: string;
}

export interface D1UploadStore {
  reserve(request: UploadReservationRequest): Promise<UploadReservation>;
  markAvailable(tenant: string, uploadId: string, now: Date): Promise<void>;
  markFailed(tenant: string, uploadId: string, now: Date): Promise<void>;
}

export function createD1UploadStore(
  database: Database,
  createId: () => string = () => crypto.randomUUID(),
): D1UploadStore {
  return {
    reserve: async (request) => {
      const existingValue = await database.prepare(`SELECT id, sha256, byte_size, media_type,
        state, expires_at, capacity_reservation_id FROM artifact_uploads
        WHERE tenant_id = ? AND locator = ? LIMIT 1`)
        .bind(request.tenant, request.locator).first<UploadRow>();
      const nonce = nonceStatement(database, request);
      if (existingValue) {
        const existing = uploadRow(existingValue);
        if (!sameArtifact(existing, request)) {
          await database.batch([nonce]);
          return { outcome: 'conflict' };
        }
        if (existing.state === 'available' || existing.state === 'claimed') {
          await database.batch([nonce]);
          return { outcome: 'already-available', uploadId: existing.id };
        }
        if (existing.state === 'uploading' && Date.parse(existing.expires_at) > request.now.getTime()) {
          await database.batch([nonce]);
          return { outcome: 'in-progress', uploadId: existing.id };
        }

        const reservationId = `${existing.id}:capacity:${createId()}`;
        const expiresAt = uploadExpiry(request.now);
        await database.batch([
          nonce,
          database.prepare(`UPDATE capacity_reservations SET state = 'released', updated_at = ?
            WHERE id = ? AND tenant_id = ? AND state = 'reserved'`)
            .bind(request.now.toISOString(), existing.capacity_reservation_id ?? '', request.tenant),
          capacityReservationStatement(database, reservationId, request, expiresAt),
          database.prepare(`UPDATE artifact_uploads SET state = 'uploading',
            capacity_reservation_id = ?, expires_at = ?, available_at = NULL,
            updated_at = ? WHERE tenant_id = ? AND id = ?`)
            .bind(reservationId, expiresAt, request.now.toISOString(), request.tenant, existing.id),
        ]);
        return { outcome: 'reserved', uploadId: existing.id };
      }

      const uploadId = createId();
      const reservationId = `${uploadId}:capacity`;
      const expiresAt = uploadExpiry(request.now);
      await database.batch([
        nonce,
        capacityReservationStatement(database, reservationId, request, expiresAt),
        database.prepare(`INSERT INTO artifact_uploads
          (id, tenant_id, producer_client_id, locator, sha256, byte_size, media_type,
           state, capacity_reservation_id, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`)
          .bind(uploadId, request.tenant, request.clientId, request.locator, request.sha256,
            request.byteSize, request.mediaType, reservationId, expiresAt),
      ]);
      return { outcome: 'reserved', uploadId };
    },

    markAvailable: async (tenant, uploadId, now) => {
      const measuredAt = now.toISOString();
      const windowStart = `${measuredAt.slice(0, 10)}T00:00:00.000Z`;
      await database.batch([
        database.prepare(`INSERT INTO capacity_usage
          (tenant_id, resource, window_start, used, measured_at)
          SELECT tenant_id, 'r2Bytes', ?, byte_size, ? FROM artifact_uploads
          WHERE tenant_id = ? AND id = ? AND state = 'uploading'
          ON CONFLICT(tenant_id, resource, window_start) DO UPDATE SET
            used = capacity_usage.used + excluded.used, measured_at = excluded.measured_at`)
          .bind(windowStart, measuredAt, tenant, uploadId),
        database.prepare(`UPDATE capacity_reservations SET state = 'consumed', updated_at = ?
          WHERE tenant_id = ? AND id = (SELECT capacity_reservation_id FROM artifact_uploads
            WHERE tenant_id = ? AND id = ? AND state = 'uploading') AND state = 'reserved'`)
          .bind(measuredAt, tenant, tenant, uploadId),
        database.prepare(`UPDATE artifact_uploads SET state = 'available', available_at = ?,
          updated_at = ? WHERE tenant_id = ? AND id = ? AND state = 'uploading'`)
          .bind(measuredAt, measuredAt, tenant, uploadId),
      ]);
    },

    markFailed: async (tenant, uploadId, now) => {
      const failedAt = now.toISOString();
      await database.batch([
        database.prepare(`UPDATE capacity_reservations SET state = 'released', updated_at = ?
          WHERE tenant_id = ? AND id = (SELECT capacity_reservation_id FROM artifact_uploads
            WHERE tenant_id = ? AND id = ? AND state = 'uploading') AND state = 'reserved'`)
          .bind(failedAt, tenant, tenant, uploadId),
        database.prepare(`UPDATE artifact_uploads SET state = 'failed', updated_at = ?
          WHERE tenant_id = ? AND id = ? AND state = 'uploading'`)
          .bind(failedAt, tenant, uploadId),
      ]);
    },

  };
}

function nonceStatement(database: Database, request: UploadReservationRequest): Statement {
  const expiresAt = new Date(request.now.getTime() + 10 * 60 * 1_000).toISOString();
  return database.prepare(`INSERT INTO artifact_upload_nonces
    (producer_client_id, nonce, expires_at) VALUES (?, ?, ?)`)
    .bind(request.clientId, request.nonce, expiresAt);
}

function capacityReservationStatement(
  database: Database,
  reservationId: string,
  request: UploadReservationRequest,
  expiresAt: string,
): Statement {
  return database.prepare(`INSERT INTO capacity_reservations
    (id, tenant_id, resource, amount, state, expires_at)
    VALUES (?, ?, 'r2Bytes', ?, 'reserved', ?)`)
    .bind(reservationId, request.tenant, request.byteSize, expiresAt);
}

function sameArtifact(row: UploadRow, request: UploadReservationRequest): boolean {
  return row.sha256 === request.sha256
    && row.byte_size === request.byteSize
    && row.media_type === request.mediaType;
}

function uploadExpiry(now: Date): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString();
}

function uploadRow(value: UploadRow): UploadRow {
  if (typeof value.id !== 'string' || typeof value.sha256 !== 'string'
    || typeof value.byte_size !== 'number' || typeof value.media_type !== 'string'
    || typeof value.state !== 'string' || typeof value.expires_at !== 'string') {
    throw new Error('Invalid artifact upload row');
  }
  return value;
}
