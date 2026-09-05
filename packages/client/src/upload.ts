import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import {
  DeliveryError,
  validateArtifactReference,
  type ArtifactReference,
} from '@treblahq/publishing-contracts';

import { buildSignedHeadersFromHash } from './headers.js';

export interface ArtifactUploaderOptions {
  baseUrl: string;
  clientId: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  nonce?: () => string;
}

export type ArtifactUploadResult =
  | { outcome: 'available'; stored: boolean }
  | { outcome: 'retry-later'; code: string; retryAfter: string | undefined };

export interface ArtifactUploader {
  upload(input: {
    tenant: string;
    reference: ArtifactReference;
    filePath: string;
  }): Promise<ArtifactUploadResult>;
}

export function createArtifactUploader(options: ArtifactUploaderOptions): ArtifactUploader {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => crypto.randomUUID());
  const baseUrl = options.baseUrl.replace(/\/+$/u, '');

  return {
    async upload({ tenant, reference: value, filePath }) {
      const reference = validateArtifactReference(value);
      if (reference.storage !== 'r2-temporary') {
        throw new Error('Only temporary R2 artifacts can be uploaded');
      }
      const file = await stat(filePath);
      if (!file.isFile() || file.size !== reference.byteSize) {
        throw new Error('Artifact file size changed after preparation');
      }
      const hash = createHash('sha256');
      await pipeline(createReadStream(filePath), hash);
      if (hash.digest('hex') !== reference.sha256) {
        throw new Error('Artifact file content changed after preparation');
      }

      const query = new URLSearchParams({
        locator: reference.locator,
        size: String(reference.byteSize),
        mediaType: reference.mediaType,
      });
      const path = `/v1/artifacts?${query.toString()}`;
      const headers = await buildSignedHeadersFromHash({
        clientId: options.clientId,
        secret: options.secret,
        method: 'PUT',
        path,
        tenant,
        timestamp: now().toISOString(),
        nonce: nonce(),
        bodySha256: reference.sha256,
        contentType: reference.mediaType,
      });
      const body = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
      const init = {
        method: 'PUT',
        headers,
        body,
        duplex: 'half',
      } satisfies RequestInit & { duplex: 'half' };
      const response = await request(`${baseUrl}${path}`, init);
      const payload = await readRecord(response);

      if (response.status === 429) {
        return {
          outcome: 'retry-later',
          code: typeof payload.code === 'string' ? payload.code : 'ARTIFACT_CAPACITY_REJECTED',
          retryAfter: typeof payload.retryAfter === 'string'
            ? payload.retryAfter
            : response.headers.get('retry-after') ?? undefined,
        };
      }
      if (!response.ok) {
        throw new DeliveryError({
          code: typeof payload.code === 'string' ? payload.code : 'ARTIFACT_UPLOAD_FAILED',
          category: response.status === 409 ? 'terminal' : 'retryable',
          message: `Artifact upload returned HTTP ${String(response.status)}`,
        });
      }
      if (payload.status !== 'stored' && payload.status !== 'already-available') {
        throw new DeliveryError({
          code: 'ARTIFACT_UPLOAD_RESPONSE_MALFORMED',
          category: 'ambiguous',
          message: 'Artifact upload returned no availability status',
        });
      }
      return { outcome: 'available', stored: payload.status === 'stored' };
    },
  };
}

async function readRecord(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
