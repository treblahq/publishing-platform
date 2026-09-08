import type { PublicMediaGrant, PublicMediaIdentity } from './public-media.js';

interface GrantDatabase {
  prepare(sql: string): {
    bind(...values: unknown[]): { first(): Promise<unknown> };
  };
}

export function createD1PublicMediaResolver(
  database: GrantDatabase, allowedAdapters: readonly string[], now: () => Date,
): (identity: PublicMediaIdentity) => Promise<PublicMediaGrant | null> {
  const adapters = [...new Set(allowedAdapters)].filter((adapter) => adapter !== 'social.shadow');
  return async (identity) => {
    if (!adapters.length || !validIdentity(identity)) return null;
    const instant = now();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return null;
    // Eligibility is filtered before LIMIT so an ineligible delivery cannot hide a live grant.
    // This read neither approves publication nor acquires/extends artifact retention.
    const row = await database.prepare(`SELECT g.tenant_id AS tenant, g.artifact_id AS artifactId,
        g.sha256 AS sha256, a.locator AS locator, a.byte_size AS byteSize,
        a.media_type AS mediaType, strftime('%Y-%m-%dT%H:%M:%fZ', g.expires_at) AS expiresAt
      FROM public_media_grants g
      INNER JOIN tenants t ON t.id = g.tenant_id AND t.enabled = 1
      INNER JOIN artifacts a ON a.id = g.artifact_id AND a.tenant_id = g.tenant_id
        AND a.sha256 = g.sha256 AND a.storage = 'r2-temporary' AND a.state = 'available'
        AND a.tombstoned_at IS NULL AND a.deleted_at IS NULL
      INNER JOIN artifact_references r ON r.artifact_id = g.artifact_id
        AND r.delivery_id = g.delivery_id AND r.tenant_id = g.tenant_id AND r.safe_to_delete = 0
      INNER JOIN deliveries d ON d.id = g.delivery_id AND d.tenant_id = g.tenant_id
      INNER JOIN adapter_controls c ON c.tenant_id = g.tenant_id AND c.adapter = d.adapter AND c.enabled = 1
      WHERE g.tenant_id = ? AND g.artifact_id = ? AND g.sha256 = ?
        AND g.revoked_at IS NULL AND julianday(g.approved_at) <= julianday(?)
        AND julianday(g.expires_at) > julianday(?)
        AND strftime('%Y-%m-%dT%H:%M:%fZ', g.expires_at) IS NOT NULL
        AND d.state IN ('ready', 'delivering', 'delivered', 'processing', 'retry_wait', 'reconciling')
        AND d.adapter IN (${adapters.map(() => '?').join(', ')})
        AND d.adapter <> 'social.shadow'
      LIMIT 1`).bind(identity.tenant, identity.artifactId, identity.sha256,
      instant.toISOString(), instant.toISOString(), ...adapters).first();
    return validRow(row, identity, instant.getTime()) ? row : null;
  };
}

function validIdentity(value: unknown): value is PublicMediaIdentity {
  if (value === null || typeof value !== 'object') return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.tenant === 'string' && /^[a-z0-9-]{1,64}$/u.test(identity.tenant)
    && identity.tenant !== 'equity' && typeof identity.artifactId === 'string'
    && /^[a-zA-Z0-9_-]{16,128}$/u.test(identity.artifactId)
    && typeof identity.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(identity.sha256);
}

function validRow(row: unknown, identity: PublicMediaIdentity, now: number): row is PublicMediaGrant {
  if (row === null || typeof row !== 'object') return false;
  const grant = row as Record<string, unknown>;
  return grant.tenant === identity.tenant && grant.artifactId === identity.artifactId
    && grant.sha256 === identity.sha256
    && typeof grant.mediaType === 'string' && ['image/png', 'image/jpeg', 'video/mp4'].includes(grant.mediaType)
    && typeof grant.byteSize === 'number' && Number.isSafeInteger(grant.byteSize)
    && grant.byteSize > 0 && grant.byteSize <= 50_000_000
    && typeof grant.expiresAt === 'string' && Date.parse(grant.expiresAt) > now
    && typeof grant.locator === 'string' && grant.locator.startsWith(`temporary/${identity.tenant}/`)
    && grant.locator.length <= 900 && /^[a-zA-Z0-9/_.-]+$/u.test(grant.locator)
    && !grant.locator.includes('..');
}
