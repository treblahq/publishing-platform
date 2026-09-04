import {
  validateWebEntityRevision,
  type WebEntityKind,
  type WebEntityRevision,
  type WebEntityStatus,
} from '@treblahq/publishing-contracts';

export interface EntityObjectStore {
  put(key: string, bytes: Uint8Array, metadata: Record<string, string>): Promise<void>;
  head(key: string): Promise<{ size: number; metadata: Record<string, string> } | null>;
  get(key: string): Promise<Uint8Array | null>;
}

export interface ActiveManifest {
  kind: WebEntityKind;
  id: string;
  revision: string;
  status: WebEntityStatus;
  contentSha256: string;
  objectKey: string;
}

export interface ActiveManifestStore {
  activate(entity: WebEntityRevision, objectKey: string): Promise<void>;
  find(kind: WebEntityKind, id: string): Promise<ActiveManifest | null>;
}

export interface EntityStores {
  objects: EntityObjectStore;
  manifests: ActiveManifestStore;
}

export async function stageAndActivateEntity(
  value: unknown,
  stores: EntityStores,
): Promise<ActiveManifest> {
  const entity = validateWebEntityRevision(value);
  const current = await stores.manifests.find(entity.kind, entity.id);
  if (current?.revision === entity.revision && current.contentSha256 !== entity.contentSha256) {
    throw new Error('Revision reuse has different content');
  }

  const bytes = new TextEncoder().encode(JSON.stringify(entity.content));
  const calculatedHash = await sha256(bytes);
  if (calculatedHash !== entity.contentSha256) {
    throw new Error('Entity content hash does not match the staged payload');
  }

  const objectKey = [
    'entities',
    encodeURIComponent(entity.tenant),
    entity.kind,
    encodeURIComponent(entity.id),
    encodeURIComponent(entity.revision),
    `${entity.contentSha256}.json`,
  ].join('/');
  const metadata = {
    sha256: entity.contentSha256,
    revision: entity.revision,
    status: entity.status,
  };

  await stores.objects.put(objectKey, bytes, metadata);
  const [head, storedBytes] = await Promise.all([
    stores.objects.head(objectKey),
    stores.objects.get(objectKey),
  ]);
  if (!head || !storedBytes) throw new Error('Staged entity object is missing');
  if (head.size !== bytes.byteLength) throw new Error('Staged entity size verification failed');
  if (head.metadata.sha256 !== entity.contentSha256) {
    throw new Error('Staged entity metadata hash verification failed');
  }
  if (await sha256(storedBytes) !== entity.contentSha256) {
    throw new Error('Staged entity byte hash verification failed');
  }

  await stores.manifests.activate(entity, objectKey);
  const active = await stores.manifests.find(entity.kind, entity.id);
  if (!active || active.revision !== entity.revision || active.contentSha256 !== entity.contentSha256) {
    throw new Error('Entity manifest activation verification failed');
  }
  return active;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
