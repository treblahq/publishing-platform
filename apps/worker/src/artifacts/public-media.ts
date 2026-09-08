export interface PublicMediaIdentity {
  tenant: string;
  artifactId: string;
  sha256: string;
}

export interface PublicMediaGrant extends PublicMediaIdentity {
  locator: string;
  byteSize: number;
  mediaType: string;
  expiresAt: string;
}

export interface MediaRange { offset: number; length: number }

export interface PublicMediaObject {
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  checksums: { sha256?: ArrayBuffer };
}

export interface PublicMediaBody extends PublicMediaObject {
  body: ReadableStream;
  range?: MediaRange;
}

export interface PublicMediaDependencies {
  enabled: boolean;
  now(): Date;
  /** Account-wide admission must include the bounded D1 and R2 cost of this request. */
  admit(): Promise<boolean>;
  /** Return only approved grants with a live provider retention reference. Never extend it here. */
  resolve(identity: PublicMediaIdentity): Promise<PublicMediaGrant | null>;
  bucket: {
    head(key: string): Promise<PublicMediaObject | null>;
    get(key: string, range?: MediaRange): Promise<PublicMediaBody | null>;
  };
}

export async function handlePublicMediaRequest(
  request: Request,
  dependencies: PublicMediaDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/media\/([a-z0-9-]{1,64})\/([a-zA-Z0-9_-]{16,128})\/([a-f0-9]{64})$/u.exec(url.pathname);
  if (!dependencies.enabled || !['GET', 'HEAD'].includes(request.method)
    || url.search || !match?.[1] || !match[2] || !match[3] || match[1] === 'equity') return denied(404);
  const identity = { tenant: match[1], artifactId: match[2], sha256: match[3] };
  try {
    if (!await dependencies.admit()) return denied(503);
    const grant = await dependencies.resolve(identity);
    if (!grant || !validGrant(grant, identity, dependencies.now())) return denied(404);
    const requestedRange = request.method === 'GET' ? request.headers.get('range') : null;
    const range = requestedRange === null ? undefined : parseRange(requestedRange, grant);
    if (range === null) return new Response(null, {
      status: 416, headers: { ...safeHeaders, 'content-range': `bytes */${String(grant.byteSize)}` },
    });
    if (range && !verified(await dependencies.bucket.head(grant.locator), grant)) return denied(404);
    const object = request.method === 'HEAD' ? await dependencies.bucket.head(grant.locator)
      : await dependencies.bucket.get(grant.locator, range);
    if (!verified(object, grant) || !validGrant(grant, identity, dependencies.now())) {
      if (object && hasBody(object)) await object.body.cancel();
      return denied(404);
    }
    if (request.method === 'GET' && (!hasBody(object) || !sameRange(object.range, range))) {
      if (hasBody(object)) await object.body.cancel();
      return denied(404);
    }
    return new Response(request.method === 'GET' && hasBody(object) ? object.body : null, {
      status: range ? 206 : 200,
      headers: {
        ...safeHeaders,
        'content-type': grant.mediaType,
        'content-length': String(range?.length ?? grant.byteSize),
        etag: `"sha256-${grant.sha256}"`,
        ...(grant.mediaType === 'video/mp4' ? { 'accept-ranges': 'bytes' } : {}),
        ...(range ? { 'content-range': `bytes ${String(range.offset)}-${String(range.offset + range.length - 1)}/${String(grant.byteSize)}` } : {}),
      },
    });
  } catch {
    return denied(503);
  }
}

function hasBody(object: PublicMediaObject): object is PublicMediaBody {
  return 'body' in object;
}

function sameRange(actual: MediaRange | undefined, expected: MediaRange | undefined): boolean {
  return expected ? actual?.offset === expected.offset && actual.length === expected.length : actual === undefined;
}

function parseRange(header: string, grant: PublicMediaGrant): MediaRange | null {
  if (grant.mediaType !== 'video/mp4') return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const maximum = 5_000_000;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || suffix > maximum) return null;
    const length = Math.min(suffix, grant.byteSize);
    return { offset: grant.byteSize - length, length };
  }
  const offset = Number(match[1]);
  const end = match[2] ? Number(match[2]) : Math.min(grant.byteSize - 1, offset + maximum - 1);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end)
    || offset >= grant.byteSize || end < offset) return null;
  const length = Math.min(end, grant.byteSize - 1) - offset + 1;
  return length > maximum ? null : { offset, length };
}

const safeHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function denied(status: number): Response {
  return new Response(null, { status, headers: safeHeaders });
}

function validGrant(grant: PublicMediaGrant, identity: PublicMediaIdentity, now: Date): boolean {
  return grant.tenant === identity.tenant && grant.artifactId === identity.artifactId
    && grant.sha256 === identity.sha256
    && ['image/png', 'image/jpeg', 'video/mp4'].includes(grant.mediaType)
    && Number.isSafeInteger(grant.byteSize) && grant.byteSize > 0 && grant.byteSize <= 50_000_000
    && Date.parse(grant.expiresAt) > now.getTime()
    && grant.locator.startsWith(`temporary/${identity.tenant}/`)
    && grant.locator.length <= 900 && /^[a-zA-Z0-9/_.-]+$/u.test(grant.locator)
    && !grant.locator.includes('..');
}

function verified(object: PublicMediaObject | null, grant: PublicMediaGrant): object is PublicMediaObject {
  return object !== null && object.size === grant.byteSize
    && object.httpMetadata?.contentType === grant.mediaType
    && object.customMetadata?.tenant === grant.tenant
    && object.customMetadata.sha256 === grant.sha256
    && object.customMetadata.mediaType === grant.mediaType
    && object.checksums.sha256 !== undefined
    && [...new Uint8Array(object.checksums.sha256)]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('') === grant.sha256;
}
