const roles = ['opengraph', 'instagram-feed', 'instagram-story', 'social-video'] as const;
type Role = typeof roles[number];
export interface OpeningsBridgeMedia {
  role: Role; artifactId: string; sha256: string; byteSize: number;
  mediaType: 'image/png' | 'image/jpeg' | 'video/mp4'; width: number; height: number; renderVersion: string;
}
export interface OpeningsBridge {
  schemaVersion: 1; tenant: 'openings'; jobId: string; entityRevision: string;
  entityContentSha256: string; generation: number; media: OpeningsBridgeMedia[];
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
export function validBridgeString(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) return false;
  }
  return true;
}
function integer(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

// Structural validation describes declared dimensions; it does not inspect media bytes.
export function parseOpeningsBridge(value: unknown): OpeningsBridge | null {
  if (!exact(value, ['schemaVersion', 'tenant', 'jobId', 'entityRevision', 'entityContentSha256', 'generation', 'media'])
    || value.schemaVersion !== 1 || value.tenant !== 'openings' || !validBridgeString(value.jobId)
    || !validBridgeString(value.entityRevision) || !hash(value.entityContentSha256)
    || !integer(value.generation, Number.MAX_SAFE_INTEGER) || !Array.isArray(value.media)
    || value.media.length < 1 || value.media.length > 4) return null;
  const media: OpeningsBridgeMedia[] = [];
  for (const item of value.media) {
    if (!exact(item, ['role', 'artifactId', 'sha256', 'byteSize', 'mediaType', 'width', 'height', 'renderVersion'])
      || !roles.includes(item.role as Role) || media.some((entry) => entry.role === item.role)
      || typeof item.artifactId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/u.test(item.artifactId)
      || !hash(item.sha256) || !integer(item.byteSize, 50_000_000)
      || !integer(item.width, 8192) || !integer(item.height, 8192)
      || typeof item.renderVersion !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(item.renderVersion)
      || (item.role === 'social-video' ? item.mediaType !== 'video/mp4'
        : item.mediaType !== 'image/png' && item.mediaType !== 'image/jpeg')) return null;
    media.push({ role: item.role as Role, artifactId: item.artifactId, sha256: item.sha256,
      byteSize: item.byteSize, mediaType: item.mediaType as OpeningsBridgeMedia['mediaType'],
      width: item.width, height: item.height, renderVersion: item.renderVersion });
  }
  media.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role));
  return { schemaVersion: 1, tenant: 'openings', jobId: value.jobId, entityRevision: value.entityRevision,
    entityContentSha256: value.entityContentSha256, generation: value.generation, media };
}
