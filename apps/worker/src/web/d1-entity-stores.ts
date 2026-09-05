import type {
  ActiveManifest, ActiveManifestStore, EntityObjectStore, EntityStores,
} from '@treblahq/publishing-adapter-r2';
import type { WebEntityKind, WebEntityRevision } from '@treblahq/publishing-contracts';

interface Statement {
  bind(...values: unknown[]): Statement;
  first(): Promise<unknown>;
  run(): Promise<unknown>;
}
interface Database { prepare(sql: string): Statement }

export function createD1R2EntityStores(database: Database, bucket: R2Bucket, tenant: string): EntityStores {
  const objects: EntityObjectStore = {
    put: async (key, bytes, metadata) => { await bucket.put(key, bytes, { customMetadata: metadata }); },
    head: async (key) => {
      const value = await bucket.head(key);
      return value ? { size: value.size, metadata: value.customMetadata ?? {} } : null;
    },
    get: async (key) => {
      const value = await bucket.get(key);
      return value ? new Uint8Array(await value.arrayBuffer()) : null;
    },
  };
  const manifests: ActiveManifestStore = {
    activate: async (entity, objectKey) => activate(database, tenant, entity, objectKey),
    find: async (kind, id) => find(database, tenant, kind, id),
  };
  return { objects, manifests };
}

async function activate(database: Database, tenant: string, entity: WebEntityRevision, objectKey: string) {
  const current = await find(database, tenant, entity.kind, entity.id);
  if (current?.revision === entity.revision && current.contentSha256 !== entity.contentSha256) {
    throw new Error('Revision reuse has different content');
  }
  await database.prepare(`INSERT INTO web_entity_manifests
    (tenant_id, kind, entity_id, revision, status, title, summary, canonical_path, content_sha256, object_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, kind, entity_id) DO UPDATE SET
      revision=excluded.revision, status=excluded.status, title=excluded.title,
      summary=excluded.summary, canonical_path=excluded.canonical_path,
      content_sha256=excluded.content_sha256, object_key=excluded.object_key,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .bind(tenant, entity.kind, entity.id, entity.revision, entity.status, entity.title,
      entity.summary ?? null, entity.canonicalPath, entity.contentSha256, objectKey).run();
}

export interface StoredWebManifest extends ActiveManifest {
  title: string;
  summary?: string;
  canonicalPath: string;
}

export async function find(
  database: Database, tenant: string, kind: WebEntityKind, id: string,
): Promise<StoredWebManifest | null> {
  const row = await database.prepare(`SELECT kind, entity_id, revision, status, title, summary,
    canonical_path, content_sha256, object_key FROM web_entity_manifests
    WHERE tenant_id = ? AND kind = ? AND entity_id = ? LIMIT 1`).bind(tenant, kind, id).first();
  if (!record(row)) return null;
  return {
    kind: String(row.kind) as WebEntityKind, id: String(row.entity_id), revision: String(row.revision),
    status: String(row.status) as ActiveManifest['status'], title: String(row.title),
    ...(typeof row.summary === 'string' ? { summary: row.summary } : {}),
    canonicalPath: String(row.canonical_path), contentSha256: String(row.content_sha256),
    objectKey: String(row.object_key),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
