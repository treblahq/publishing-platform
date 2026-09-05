import {
  validatePublicationEnvelope,
  type PublicationEnvelope,
} from '@trebla/publishing-contracts';

interface Statement {
  bind(...values: unknown[]): Statement;
  first(): Promise<unknown>;
}
interface Database { prepare(sql: string): Statement }
interface StoredObject {
  size: number;
  customMetadata?: Record<string, string>;
  checksums: { sha256?: ArrayBuffer };
}
interface Bucket { head(key: string): Promise<StoredObject | null> }

export async function verifyTemporaryArtifacts(
  database: Database,
  bucket: Bucket,
  tenant: string,
  value: PublicationEnvelope,
): Promise<boolean> {
  const envelope = validatePublicationEnvelope(value);
  if (envelope.identity.tenant !== tenant) return false;
  const artifacts = envelope.artifacts.filter(({ storage }) => storage === 'r2-temporary');
  for (const artifact of artifacts) {
    const row = await database.prepare(`SELECT id FROM artifact_uploads
      WHERE tenant_id = ? AND locator = ? AND sha256 = ? AND byte_size = ?
        AND media_type = ? AND state IN ('available', 'claimed') LIMIT 1`)
      .bind(tenant, artifact.locator, artifact.sha256, artifact.byteSize, artifact.mediaType)
      .first();
    if (!row) return false;
    const object = await bucket.head(artifact.locator);
    if (!matches(object, tenant, artifact.sha256, artifact.byteSize, artifact.mediaType)) return false;
  }
  return true;
}

function matches(
  value: StoredObject | null,
  tenant: string,
  sha256: string,
  byteSize: number,
  mediaType: string,
): boolean {
  return value !== null
    && value.size === byteSize
    && value.customMetadata?.sha256 === sha256
    && value.customMetadata.tenant === tenant
    && value.customMetadata.mediaType === mediaType
    && value.checksums.sha256 !== undefined
    && bufferHex(value.checksums.sha256) === sha256;
}

function bufferHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
