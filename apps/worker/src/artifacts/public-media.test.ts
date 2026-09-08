import { describe, expect, it } from 'vitest';
import { handlePublicMediaRequest, type PublicMediaDependencies, type PublicMediaGrant } from './public-media.js';

const hash = 'ab'.repeat(32);
const artifactId = '37b7ca51-38d8-4851-948f-759ef74c3778';
const now = new Date('2026-09-08T20:00:00Z');
const grant: PublicMediaGrant = {
  tenant: 'openings', artifactId, sha256: hash, byteSize: 10, mediaType: 'image/png',
  locator: `temporary/openings/publication/${hash}.png`,
  expiresAt: '2026-09-08T21:00:00Z',
};
const address = `https://example.test/media/openings/${artifactId}/${hash}`;

function fixture(overrides: Partial<PublicMediaGrant> = {}) {
  const selected = { ...grant, ...overrides };
  const calls: string[] = [];
  const metadata = {
    size: selected.byteSize,
    httpMetadata: { contentType: selected.mediaType },
    customMetadata: { tenant: selected.tenant, sha256: selected.sha256, mediaType: selected.mediaType },
    checksums: { sha256: new Uint8Array(32).fill(171).buffer },
  };
  const dependencies: PublicMediaDependencies = {
    enabled: true,
    now: () => now,
    admit: () => { calls.push('admit'); return Promise.resolve(true); },
    resolve: (identity) => {
      calls.push('resolve');
      expect(identity).toEqual({ tenant: 'openings', artifactId, sha256: hash });
      return Promise.resolve(selected);
    },
    bucket: {
      head: (key) => { calls.push(`head:${key}`); return Promise.resolve(metadata); },
      get: (key, range) => {
        calls.push(`get:${key}`);
        const bytes = new Uint8Array(selected.byteSize).map((_, i) => i);
        const body = new Response(range ? bytes.slice(range.offset, range.offset + range.length) : bytes).body;
        if (!body) throw new Error('Missing fixture body');
        return Promise.resolve({
          ...metadata,
          ...(range ? { range } : {}),
          body,
        });
      },
    },
  };
  return { dependencies, calls, metadata };
}

describe('public media transport (not enabled in the Worker)', () => {
  it('streams an exact approved image without a preliminary storage read', async () => {
    const { dependencies, calls } = fixture();
    const response = await handlePublicMediaRequest(new Request(address), dependencies);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.get('etag')).toBe(`"sha256-${hash}"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(calls).toEqual(['admit', 'resolve', `get:${grant.locator}`]);
  });

  it('uses only object metadata for HEAD and ignores Range', async () => {
    const { dependencies, calls } = fixture();
    const response = await handlePublicMediaRequest(new Request(address, {
      method: 'HEAD', headers: { range: 'bytes=0-2' },
    }), dependencies);
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-length')).toBe('10');
    expect(calls).toEqual(['admit', 'resolve', `head:${grant.locator}`]);
  });

  it('has no external work when explicitly disabled', async () => {
    const { dependencies, calls } = fixture();
    dependencies.enabled = false;
    expect((await handlePublicMediaRequest(new Request(address), dependencies)).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it.each([
    '/media/openings/key/not-a-hash', `/media/openings/${artifactId}/${hash}?key=private`,
    `/media/openings/%2f${artifactId}/${hash}`, `/media/equity/${artifactId}/${hash}`,
  ])('does not touch dependencies for an invalid or forbidden route: %s', async (path) => {
    const { dependencies, calls } = fixture();
    expect((await handlePublicMediaRequest(new Request(`https://example.test${path}`), dependencies)).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('rejects mutation methods without accessing storage', async () => {
    const { dependencies, calls } = fixture();
    expect((await handlePublicMediaRequest(new Request(address, { method: 'POST' }), dependencies)).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it.each([false, 'throws'])('fails closed before resolving when admission is %s', async (outcome) => {
    const { dependencies, calls } = fixture();
    dependencies.admit = () => {
      if (outcome === 'throws') throw new Error('private backend detail');
      return Promise.resolve(false);
    };
    const response = await handlePublicMediaRequest(new Request(address), dependencies);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain('private');
    expect(calls).toEqual([]);
  });

  it('does not read an unclaimed/private/released artifact when the resolver denies it', async () => {
    const { dependencies, calls } = fixture();
    dependencies.resolve = () => Promise.resolve(null);
    expect((await handlePublicMediaRequest(new Request(address), dependencies)).status).toBe(404);
    expect(calls).toEqual(['admit']);
  });

  it.each([
    { tenant: 'troco' }, { artifactId: 'other' }, { sha256: 'cd'.repeat(32) },
    { expiresAt: now.toISOString() }, { expiresAt: 'invalid' },
    { mediaType: 'image/svg+xml' }, { mediaType: 'text/html' }, { mediaType: 'application/json' },
    { byteSize: 0 }, { byteSize: 50_000_001 }, { byteSize: 1.5 },
    { locator: `temporary/troco/${hash}.png` }, { locator: `temporary/openings/../${hash}.png` },
    { locator: `temporary/openings/%2e%2e/${hash}.png` },
  ])('rejects an unsafe resolved grant: %j', async (override) => {
    const { dependencies, calls } = fixture(override);
    expect((await handlePublicMediaRequest(new Request(address), dependencies)).status).toBe(404);
    expect(calls).toEqual(['admit', 'resolve']);
  });

  it.each(['size', 'tenant', 'sha256', 'mime', 'checksum'])('rejects object %s divergence', async (field) => {
    const { dependencies, metadata } = fixture();
    if (field === 'size') metadata.size = 9;
    if (field === 'tenant') metadata.customMetadata.tenant = 'troco';
    if (field === 'sha256') metadata.customMetadata.sha256 = 'cd'.repeat(32);
    if (field === 'mime') metadata.httpMetadata.contentType = 'text/html';
    if (field === 'checksum') metadata.checksums.sha256 = new ArrayBuffer(32);
    const response = await handlePublicMediaRequest(new Request(address), dependencies);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('does not expose internal exceptions or fall back to HTML', async () => {
    const { dependencies } = fixture();
    dependencies.bucket.get = () => { throw new Error('secret bucket key'); };
    const response = await handlePublicMediaRequest(new Request(address), dependencies);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it.each([
    ['bytes=2-4', [2, 3, 4], 'bytes 2-4/10'],
    ['bytes=7-', [7, 8, 9], 'bytes 7-9/10'],
    ['bytes=-3', [7, 8, 9], 'bytes 7-9/10'],
    ['bytes=7-20', [7, 8, 9], 'bytes 7-9/10'],
  ] as const)('streams a verified video range %s', async (range, bytes, contentRange) => {
    const { dependencies, calls } = fixture({ mediaType: 'video/mp4' });
    const response = await handlePublicMediaRequest(new Request(address, { headers: { range } }), dependencies);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(contentRange);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe(String(bytes.length));
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(bytes);
    expect(calls).toEqual(['admit', 'resolve', `head:${grant.locator}`, `get:${grant.locator}`]);
  });

  it.each(['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=1.5-2', 'items=0-1', 'bytes=0-9007199254740993'])('rejects invalid video range %s', async (range) => {
    const { dependencies, calls } = fixture({ mediaType: 'video/mp4' });
    const response = await handlePublicMediaRequest(new Request(address, { headers: { range } }), dependencies);
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    expect(calls.some((call) => call.startsWith('get:'))).toBe(false);
  });

  it('rejects image ranges without fetching bytes', async () => {
    const { dependencies, calls } = fixture();
    expect((await handlePublicMediaRequest(new Request(address, {
      headers: { range: 'bytes=0-2' },
    }), dependencies)).status).toBe(416);
    expect(calls.some((call) => call.startsWith('get:'))).toBe(false);
  });

  it.each(['bytes=0-5000000', 'bytes=-5000001'])('rejects an oversized explicit range %s', async (range) => {
    const { dependencies, calls } = fixture({ mediaType: 'video/mp4', byteSize: 6_000_000 });
    expect((await handlePublicMediaRequest(new Request(address, { headers: { range } }), dependencies)).status).toBe(416);
    expect(calls.some((call) => call.startsWith('get:'))).toBe(false);
  });

  it('caps an open-ended video range at five million bytes', async () => {
    const { dependencies } = fixture({ mediaType: 'video/mp4', byteSize: 6_000_000 });
    const response = await handlePublicMediaRequest(new Request(address, {
      headers: { range: 'bytes=0-' },
    }), dependencies);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-4999999/6000000');
    expect((await response.arrayBuffer()).byteLength).toBe(5_000_000);
  });

  it.each(['checksum', 'range', 'expiry'])('denies a replacement or expiry between HEAD and GET: %s', async (change) => {
    const { dependencies, metadata } = fixture({ mediaType: 'video/mp4' });
    let cancelled = false;
    dependencies.bucket.get = () => {
      if (change === 'expiry') dependencies.now = () => new Date(grant.expiresAt);
      return Promise.resolve({
        ...metadata,
        checksums: { sha256: change === 'checksum' ? new ArrayBuffer(32) : metadata.checksums.sha256 },
        range: { offset: change === 'range' ? 1 : 0, length: 3 },
        body: new ReadableStream({ cancel: () => { cancelled = true; } }),
      });
    };
    const response = await handlePublicMediaRequest(new Request(address, { headers: { range: 'bytes=0-2' } }), dependencies);
    expect(response.status).toBe(404);
    expect(cancelled).toBe(true);
    expect(await response.text()).toBe('');
  });
});
