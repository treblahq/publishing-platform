interface Statement {
  bind(...values: unknown[]): Statement;
  first(): Promise<unknown>;
  all(): Promise<{ results?: unknown[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
interface Database { prepare(sql: string): Statement }
interface Bucket { delete(key: string): Promise<unknown> }

export async function runD1ArtifactCleanup(
  database: Database,
  bucket: Bucket,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) throw new Error('Cleanup limit must be between 1 and 100');
  const cursorValue = await database.prepare(`SELECT cursor FROM maintenance_cursors
    WHERE name = 'artifact-cleanup' LIMIT 1`).first();
  const cursor = readCursor(cursorValue);
  const page = await database.prepare(`SELECT artifact.id, artifact.tenant_id, artifact.locator
    FROM artifacts AS artifact
    WHERE artifact.storage = 'r2-temporary' AND artifact.state <> 'deleted' AND artifact.id > ?
      AND NOT EXISTS (
        SELECT 1 FROM artifact_references AS reference
        JOIN deliveries AS delivery ON delivery.id = reference.delivery_id
        WHERE reference.artifact_id = artifact.id AND delivery.state = 'reconciling'
      )
      AND (
        artifact.state = 'tombstoned'
        OR (artifact.state = 'staged' AND artifact.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours'))
        OR NOT EXISTS (SELECT 1 FROM artifact_references AS reference WHERE reference.artifact_id = artifact.id)
        OR NOT EXISTS (SELECT 1 FROM artifact_references AS reference
          WHERE reference.artifact_id = artifact.id AND reference.safe_to_delete = 0)
        OR (artifact.created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')
          AND EXISTS (SELECT 1 FROM artifact_references AS reference
            JOIN deliveries AS delivery ON delivery.id = reference.delivery_id
            WHERE reference.artifact_id = artifact.id
              AND delivery.state IN ('failed_terminal','needs_attention','cancelled','skipped'))
          AND NOT EXISTS (SELECT 1 FROM artifact_references AS reference
            JOIN deliveries AS delivery ON delivery.id = reference.delivery_id
            WHERE reference.artifact_id = artifact.id
              AND delivery.state NOT IN ('failed_terminal','needs_attention','cancelled','skipped')))
      )
    ORDER BY artifact.id LIMIT ?`).bind(cursor, limit).all();
  const candidates = (page.results ?? []).map(cleanupRow);
  if (candidates.length === 0) {
    if (cursor !== '') await saveCursor(database, 'artifact-cleanup', '');
    return 0;
  }
  for (const candidate of candidates) {
    await database.prepare(`UPDATE artifacts SET state = 'tombstoned',
      tombstoned_at = COALESCE(tombstoned_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE tenant_id = ? AND id = ? AND state <> 'deleted'`).bind(candidate.tenantId, candidate.id).run();
    await bucket.delete(candidate.locator);
    await database.prepare(`UPDATE artifacts SET state = 'deleted', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      deletion_reason = COALESCE(deletion_reason, 'retention-satisfied') WHERE tenant_id = ? AND id = ?`)
      .bind(candidate.tenantId, candidate.id).run();
    await saveCursor(database, 'artifact-cleanup', candidate.id);
  }
  return candidates.length;
}

export async function runD1UploadCleanup(
  database: Database,
  bucket: Bucket,
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) throw new Error('Cleanup limit must be between 1 and 100');
  const cursorValue = await database.prepare(`SELECT cursor FROM maintenance_cursors
    WHERE name = 'artifact-upload-cleanup' LIMIT 1`).first();
  const cursor = readCursor(cursorValue);
  const page = await database.prepare(`SELECT id, tenant_id, locator FROM artifact_uploads
    WHERE id > ? AND state IN ('uploading', 'available', 'failed')
      AND (state = 'failed' OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ORDER BY id LIMIT ?`).bind(cursor, limit).all();
  const candidates = (page.results ?? []).map(cleanupRow);
  if (candidates.length === 0) {
    if (cursor !== '') await saveCursor(database, 'artifact-upload-cleanup', '');
    return 0;
  }
  let deleted = 0;
  for (const candidate of candidates) {
    const claimed = await database.prepare(`UPDATE artifact_uploads SET state = 'failed',
      error_code = COALESCE(error_code, 'upload-expired')
      WHERE tenant_id = ? AND id = ? AND state IN ('uploading', 'available', 'failed')
        AND (state = 'failed' OR expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
      .bind(candidate.tenantId, candidate.id).run();
    if (claimed.meta?.changes === 0) continue;
    await bucket.delete(candidate.locator);
    await database.prepare(`UPDATE artifact_uploads SET state = 'deleted',
      deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE tenant_id = ? AND id = ? AND state = 'failed'`).bind(candidate.tenantId, candidate.id).run();
    await database.prepare(`UPDATE capacity_reservations SET state = 'released'
      WHERE tenant_id = ? AND id = (SELECT reservation_id FROM artifact_uploads WHERE tenant_id = ? AND id = ?)
        AND state = 'reserved'`).bind(candidate.tenantId, candidate.tenantId, candidate.id).run();
    await saveCursor(database, 'artifact-upload-cleanup', candidate.id);
    deleted += 1;
  }
  return deleted;
}

async function saveCursor(database: Database, name: string, cursor: string): Promise<void> {
  await database.prepare(`INSERT INTO maintenance_cursors (name, cursor) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET cursor = excluded.cursor,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).bind(name, cursor).run();
}

function readCursor(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '';
  const cursor = (value as Record<string, unknown>).cursor;
  return typeof cursor === 'string' ? cursor : '';
}

function cleanupRow(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid cleanup row');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.locator !== 'string') {
    throw new Error('Invalid cleanup row');
  }
  return { id: row.id, tenantId: row.tenant_id, locator: row.locator };
}
