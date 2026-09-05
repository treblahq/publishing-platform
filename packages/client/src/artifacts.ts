import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import {
  validateArtifactReference,
  type ArtifactReference,
  type ArtifactStorage,
} from '@treblahq/publishing-contracts';

export interface PrepareArtifactReferenceInput {
  id: string;
  filePath: string;
  storage: ArtifactStorage;
  locator: string;
  mediaType: string;
  allowedMediaTypes: readonly string[];
  maxByteSize: number;
}

export async function prepareArtifactReference(
  input: PrepareArtifactReferenceInput,
): Promise<ArtifactReference> {
  if (!input.allowedMediaTypes.includes(input.mediaType)) {
    throw new Error('Artifact media type is not allowed');
  }
  if (!Number.isSafeInteger(input.maxByteSize) || input.maxByteSize <= 0) {
    throw new Error('Artifact byte limit must be a positive integer');
  }

  const file = await stat(input.filePath);
  if (!file.isFile()) throw new Error('Artifact path must be a file');
  if (file.size === 0) throw new Error('Artifact file must not be empty');
  if (file.size > input.maxByteSize) {
    throw new Error(`Artifact file exceeds the ${String(input.maxByteSize)} byte limit`);
  }

  const hash = createHash('sha256');
  await pipeline(createReadStream(input.filePath), hash);

  return validateArtifactReference({
    id: input.id,
    storage: input.storage,
    sha256: hash.digest('hex'),
    byteSize: file.size,
    mediaType: input.mediaType,
    locator: input.locator,
  });
}
