import { parseOpeningsBridge, validBridgeString, type OpeningsBridge } from './openings-bridge.js';

interface BridgeDatabase {
  prepare(sql: string): { bind(...values: unknown[]): { first(): Promise<unknown> } };
}

export function createD1OpeningsBridgeStore(database: BridgeDatabase, allowedAdapters: readonly string[]) {
  const adapters = [...new Set(allowedAdapters)].filter((adapter) => adapter !== 'social.shadow');
  // Both acceptance and read apply the same live eligibility predicate. This does
  // not acquire retention or authorize exposure; it is only a revision binding.
  const eligible = `EXISTS (
      SELECT 1 FROM web_entity_manifests e JOIN tenants t ON t.id = e.tenant_id AND t.enabled = 1
      WHERE e.tenant_id = b.tenant_id AND e.kind = 'job' AND e.entity_id = b.job_id
        AND e.status = 'active' AND e.revision = b.entity_revision
        AND e.content_sha256 = b.entity_content_sha256)
    AND NOT EXISTS (
      SELECT 1 FROM json_each(b.manifest_json, '$.media') m WHERE NOT EXISTS (
        SELECT 1 FROM artifacts a
        WHERE a.id = json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.artifactId')
          AND a.tenant_id = b.tenant_id
          AND a.sha256 = json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.sha256')
          AND a.byte_size = json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.byteSize')
          AND a.media_type = json_extract(CASE WHEN m.type = 'object' THEN m.value ELSE '{}' END, '$.mediaType')
          AND a.storage = 'r2-temporary' AND a.state = 'available'
          AND a.tombstoned_at IS NULL AND a.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM artifact_references r
            JOIN deliveries d ON d.id = r.delivery_id AND d.tenant_id = r.tenant_id
            JOIN adapter_controls c ON c.tenant_id = d.tenant_id AND c.adapter = d.adapter AND c.enabled = 1
            WHERE r.artifact_id = a.id AND r.tenant_id = a.tenant_id AND r.safe_to_delete = 0
              AND d.state IN ('ready', 'delivering', 'delivered', 'processing', 'retry_wait', 'reconciling')
              AND d.adapter <> 'social.shadow' AND d.adapter IN (${adapters.map(() => '?').join(', ')}))))`;

  async function read(jobId: string): Promise<OpeningsBridge | null> {
    if (!adapters.length || !validBridgeString(jobId)) return null;
    try {
      // Select latest before applying eligibility: an old row must never hide an
      // ineligible latest binding, even when the source revision changes back.
      const row = await database.prepare(`SELECT b.* FROM openings_job_media_bridges b
        WHERE b.tenant_id = 'openings' AND b.job_id = ? AND b.generation = (
          SELECT MAX(latest.generation) FROM openings_job_media_bridges latest
          WHERE latest.tenant_id = b.tenant_id AND latest.job_id = b.job_id)
          AND ${eligible}`).bind(jobId, ...adapters).first();
      if (!row || typeof row !== 'object') return null;
      const stored = row as Record<string, unknown>;
      if (typeof stored.manifest_json !== 'string') return null;
      const parsed = parseOpeningsBridge(JSON.parse(stored.manifest_json));
      return parsed && parsed.tenant === stored.tenant_id && parsed.jobId === jobId
        && parsed.jobId === stored.job_id && parsed.generation === stored.generation
        && parsed.entityRevision === stored.entity_revision && parsed.entityContentSha256 === stored.entity_content_sha256
        && JSON.stringify(parsed) === stored.manifest_json ? parsed : null;
    } catch {
      throw new Error('Openings bridge read failed');
    }
  }

  async function accept(value: unknown): Promise<'accepted' | 'replayed' | 'rejected'> {
    const manifest = parseOpeningsBridge(value);
    if (!adapters.length || !manifest) return 'rejected';
    const canonical = JSON.stringify(manifest);
    try {
      // One atomic conditional INSERT, no preliminary read. A replay does not
      // UPDATE anything. Canonical JSON is the collision-free manifest identity.
      const inserted = await database.prepare(`WITH b AS (
          SELECT ? AS tenant_id, ? AS job_id, ? AS generation, ? AS entity_revision,
            ? AS entity_content_sha256, ? AS manifest_json)
        INSERT INTO openings_job_media_bridges
          (tenant_id, job_id, generation, entity_revision, entity_content_sha256, manifest_json)
        SELECT b.* FROM b WHERE b.generation = (
          SELECT COALESCE(MAX(previous.generation), 0) + 1 FROM openings_job_media_bridges previous
          WHERE previous.tenant_id = b.tenant_id AND previous.job_id = b.job_id)
          AND ${eligible}
        ON CONFLICT (tenant_id, job_id, generation) DO NOTHING RETURNING generation`)
        .bind(manifest.tenant, manifest.jobId, manifest.generation, manifest.entityRevision,
          manifest.entityContentSha256, canonical, ...adapters).first();
      const current = await read(manifest.jobId);
      if (!current || JSON.stringify(current) !== canonical) return 'rejected';
      return inserted ? 'accepted' : 'replayed';
    } catch {
      throw new Error('Openings bridge acceptance failed');
    }
  }
  return { accept, read };
}
