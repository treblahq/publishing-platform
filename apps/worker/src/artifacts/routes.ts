import type { ProducerClientLoader } from '../intake/authenticate.js';
import { authenticatePreHashedRequest } from '../intake/authenticate.js';
import type { D1UploadStore } from './d1-uploads.js';

interface StoredObject {
  size: number;
  customMetadata?: Record<string, string>;
  checksums: { sha256?: ArrayBuffer };
}

interface UploadBucket {
  put(key: string, value: ReadableStream, options: {
    sha256: string;
    httpMetadata: { contentType: string };
    customMetadata: Record<string, string>;
  }): Promise<unknown>;
  head(key: string): Promise<StoredObject | null>;
}

export interface ArtifactUploadDependencies {
  now(): Date;
  loadClient: ProducerClientLoader;
  uploads: D1UploadStore;
  bucket: UploadBucket;
}

const MEDIA_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
};
const MAXIMUM_ARTIFACT_BYTES = 50_000_000;

export async function handleArtifactUploadRequest(
  request: Request,
  dependencies: ArtifactUploadDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'PUT' || url.pathname !== '/v1/artifacts') {
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  let principal;
  try {
    principal = await authenticatePreHashedRequest({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers.entries()),
      now: dependencies.now(),
    }, dependencies.loadClient);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const sha256 = request.headers.get('x-pub-content-sha256') ?? '';
  const locator = url.searchParams.get('locator') ?? '';
  const mediaType = url.searchParams.get('mediaType') ?? '';
  const byteSize = Number(url.searchParams.get('size'));
  if (!validUploadMetadata({
    tenant: principal.tenant,
    locator,
    sha256,
    byteSize,
    mediaType,
    contentType: request.headers.get('content-type') ?? '',
  })) {
    return Response.json({ code: 'INVALID_ARTIFACT' }, { status: 400 });
  }
  if (!request.body) return Response.json({ code: 'ARTIFACT_BODY_REQUIRED' }, { status: 400 });

  let reservation;
  try {
    reservation = await dependencies.uploads.reserve({
      tenant: principal.tenant,
      clientId: principal.clientId,
      nonce: principal.nonce,
      locator,
      sha256,
      byteSize,
      mediaType,
      now: dependencies.now(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('capacity reservation rejected')) {
      return Response.json({ code: 'FREE_TIER_BUDGET_EXHAUSTED' }, { status: 429 });
    }
    return Response.json({ code: 'UPLOAD_RESERVATION_FAILED' }, { status: 409 });
  }

  if (reservation.outcome === 'conflict') {
    return Response.json({ code: 'ARTIFACT_CONFLICT' }, { status: 409 });
  }
  if (reservation.outcome === 'in-progress') {
    return Response.json({ code: 'ARTIFACT_UPLOAD_IN_PROGRESS' }, {
      status: 429,
      headers: { 'retry-after': '60' },
    });
  }
  if (reservation.outcome === 'already-available') {
    const existing = await dependencies.bucket.head(locator);
    if (!verifiedObject(existing, principal.tenant, sha256, byteSize, mediaType)) {
      return Response.json({ code: 'ARTIFACT_LEDGER_DIVERGED' }, { status: 409 });
    }
    return Response.json({ status: 'already-available' });
  }

  try {
    await dependencies.bucket.put(locator, request.body, {
      sha256,
      httpMetadata: { contentType: mediaType },
      customMetadata: { sha256, tenant: principal.tenant, mediaType },
    });
    const stored = await dependencies.bucket.head(locator);
    if (!verifiedObject(stored, principal.tenant, sha256, byteSize, mediaType)) {
      throw new Error('Stored artifact verification failed');
    }
    await dependencies.uploads.markAvailable(principal.tenant, reservation.uploadId, dependencies.now());
    return Response.json({ status: 'stored' }, { status: 201 });
  } catch {
    await dependencies.uploads.markFailed(principal.tenant, reservation.uploadId, dependencies.now());
    return Response.json({ code: 'ARTIFACT_CHECKSUM_MISMATCH' }, { status: 422 });
  }
}

function validUploadMetadata(input: {
  tenant: string;
  locator: string;
  sha256: string;
  byteSize: number;
  mediaType: string;
  contentType: string;
}): boolean {
  const extensions = MEDIA_EXTENSIONS[input.mediaType];
  if (!extensions || input.contentType !== input.mediaType
    || !Number.isSafeInteger(input.byteSize) || input.byteSize <= 0
    || input.byteSize > MAXIMUM_ARTIFACT_BYTES || !/^[a-f0-9]{64}$/u.test(input.sha256)
    || !/^[a-z0-9-]+$/u.test(input.tenant) || input.locator.length > 900
    || !input.locator.startsWith(`temporary/${input.tenant}/`)
    || input.locator.includes('..') || input.locator.includes('\\')) return false;
  return extensions.some((extension) => input.locator.endsWith(`/${input.sha256}.${extension}`));
}

function verifiedObject(
  value: StoredObject | null,
  tenant: string,
  sha256: string,
  byteSize: number,
  mediaType: string,
): boolean {
  if (!value || value.size !== byteSize || value.customMetadata?.sha256 !== sha256
    || value.customMetadata.tenant !== tenant || value.customMetadata.mediaType !== mediaType
    || !value.checksums.sha256) return false;
  return bufferHex(value.checksums.sha256) === sha256;
}

function bufferHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
