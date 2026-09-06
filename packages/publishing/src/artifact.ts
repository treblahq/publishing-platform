export const ARTIFACT_STORAGE_KINDS = [
  'external',
  'r2-temporary',
  'r2-live',
] as const;

export type ArtifactStorage = (typeof ARTIFACT_STORAGE_KINDS)[number];

export interface ArtifactReference {
  id: string;
  storage: ArtifactStorage;
  sha256: string;
  byteSize: number;
  mediaType: string;
  locator: string;
}

const ARTIFACT_KEYS = new Set([
  'id',
  'storage',
  'sha256',
  'byteSize',
  'mediaType',
  'locator',
]);

export function validateArtifactReference(value: unknown): ArtifactReference {
  if (!isRecord(value) || Object.keys(value).some((key) => !ARTIFACT_KEYS.has(key))) {
    throw new Error('Artifact reference contains unsupported fields');
  }

  if (
    typeof value.id !== 'string'
    || value.id.length === 0
    || !ARTIFACT_STORAGE_KINDS.includes(value.storage as ArtifactStorage)
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(value.sha256)
    || typeof value.byteSize !== 'number'
    || !Number.isSafeInteger(value.byteSize)
    || value.byteSize <= 0
    || typeof value.mediaType !== 'string'
    || value.mediaType.length === 0
    || typeof value.locator !== 'string'
    || value.locator.length === 0
  ) {
    throw new Error('Invalid artifact reference');
  }

  return value as unknown as ArtifactReference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
