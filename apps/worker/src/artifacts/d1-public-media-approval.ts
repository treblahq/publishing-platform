interface ApprovalDatabase {
  prepare(sql: string): { bind(...values: unknown[]): { first(): Promise<unknown> } };
}

export interface PublicMediaApprovalInput {
  tenant: string;
  artifactId: string;
  sha256: string;
  deliveryId: string;
  fencingToken: number;
  expiresAt: string;
}

export function createD1PublicMediaApprovalStore(
  database: ApprovalDatabase, allowedAdapters: readonly string[], now: () => Date,
): { approve(input: PublicMediaApprovalInput): Promise<'accepted' | 'replayed' | 'rejected'> } {
  const adapters = [...new Set(allowedAdapters)].filter((adapter) => adapter !== 'social.shadow');
  // Insertion and replay share the live ownership/availability fence. Neither acquires retention.
  const eligibility = `FROM artifacts a
    JOIN tenants t ON t.id = a.tenant_id AND t.enabled = 1
    JOIN artifact_references r ON r.artifact_id = a.id AND r.tenant_id = a.tenant_id AND r.safe_to_delete = 0
    JOIN deliveries d ON d.id = r.delivery_id AND d.tenant_id = a.tenant_id
    JOIN adapter_controls c ON c.tenant_id = d.tenant_id AND c.adapter = d.adapter AND c.enabled = 1
    WHERE a.tenant_id = ? AND a.id = ? AND a.sha256 = ? AND d.id = ?
      AND a.storage = 'r2-temporary' AND a.state = 'available'
      AND a.tombstoned_at IS NULL AND a.deleted_at IS NULL
      AND a.media_type IN ('image/png', 'image/jpeg', 'video/mp4')
      AND typeof(a.byte_size) = 'integer' AND a.byte_size BETWEEN 1 AND 50000000
      AND substr(a.locator, 1, length('temporary/' || a.tenant_id || '/')) = 'temporary/' || a.tenant_id || '/'
      AND length(a.locator) <= 900 AND length(CAST(a.locator AS BLOB)) = length(a.locator)
      AND a.locator NOT GLOB '*[^a-zA-Z0-9/_.-]*' AND instr(a.locator, '..') = 0
      AND d.state IN ('delivering', 'processing', 'reconciling')
      AND d.lease_token = ? AND julianday(d.lease_expires_at) > julianday(?)
      AND d.adapter IN (${adapters.map(() => '?').join(', ')}) AND d.adapter <> 'social.shadow'`;
  return { async approve(input) {
    if (!adapters.length || !validInput(input)) return 'rejected';
    const { tenant, artifactId, sha256, deliveryId, fencingToken, expiresAt } = input;
    let approvedAt: string;
    try {
      const instant = now();
      if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return 'rejected';
      const expiry = Date.parse(expiresAt);
      if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== expiresAt
        || expiry <= instant.getTime() || expiry - instant.getTime() > 7 * 86_400_000) return 'rejected';
      approvedAt = instant.toISOString();
    } catch { return 'rejected'; }
    const fence = [tenant, artifactId, sha256, deliveryId, fencingToken, approvedAt, ...adapters];
    try {
      const inserted = await database.prepare(`INSERT INTO public_media_grants
        (tenant_id, artifact_id, delivery_id, sha256, approved_at, expires_at)
        SELECT ?, ?, ?, ?, ?, ? ${eligibility}
        ON CONFLICT DO NOTHING RETURNING 1 AS eligible`)
        .bind(tenant, artifactId, deliveryId, sha256, approvedAt, expiresAt, ...fence).first();
      if (confirmed(inserted)) return 'accepted';
      if (inserted !== null && inserted !== undefined) throw new Error('Public media approval failed');
      const replay = await database.prepare(`SELECT 1 AS eligible FROM public_media_grants g
        WHERE g.tenant_id = ? AND g.artifact_id = ? AND g.delivery_id = ? AND g.sha256 = ?
          AND g.expires_at = ? AND g.revoked_at IS NULL
          AND julianday(g.approved_at) <= julianday(?) AND julianday(g.expires_at) > julianday(?)
          AND EXISTS (SELECT 1 ${eligibility}) LIMIT 1`)
        .bind(tenant, artifactId, deliveryId, sha256, expiresAt, approvedAt, approvedAt, ...fence).first();
      return confirmed(replay) ? 'replayed' : 'rejected';
    } catch { throw new Error('Public media approval failed'); }
  } };
}

function confirmed(row: unknown): boolean {
  return row !== null && typeof row === 'object' && (row as Record<string, unknown>).eligible === 1;
}

function validInput(value: unknown): value is PublicMediaApprovalInput {
  if (value === null || typeof value !== 'object') return false;
  const keys = ['tenant', 'artifactId', 'sha256', 'deliveryId', 'fencingToken', 'expiresAt'];
  const actualKeys = Reflect.ownKeys(value);
  if (actualKeys.length !== keys.length || actualKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
  const input = value as Record<string, unknown>;
  return typeof input.tenant === 'string' && /^[a-z0-9-]{1,64}$/u.test(input.tenant)
    && !input.tenant.includes('\n') && input.tenant !== 'equity'
    && typeof input.artifactId === 'string' && /^[a-zA-Z0-9_-]{16,128}$/u.test(input.artifactId) && !input.artifactId.includes('\n')
    && typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(input.sha256) && input.sha256.length === 64
    && typeof input.deliveryId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(input.deliveryId) && !input.deliveryId.includes('\n')
    && typeof input.fencingToken === 'number' && Number.isSafeInteger(input.fencingToken) && input.fencingToken > 0
    && typeof input.expiresAt === 'string';
}
