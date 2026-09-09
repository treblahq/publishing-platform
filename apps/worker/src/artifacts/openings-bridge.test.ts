import { describe, expect, it } from 'vitest';
import { parseOpeningsBridge } from './openings-bridge.js';

export function manifest() {
  return { schemaVersion: 1, tenant: 'openings', jobId: 'job', entityRevision: 'r1',
    entityContentSha256: 'a'.repeat(64), generation: 1, media: [
      { role: 'opengraph', artifactId: 'artifact_12345678', sha256: 'b'.repeat(64), byteSize: 10,
        mediaType: 'image/png', width: 1200, height: 630, renderVersion: '1' },
    ] };
}

describe('Openings bridge schema', () => {
  it('normalizes a detached manifest without modifying input', () => {
    const input = manifest();
    input.media.unshift({ ...input.media[0], role: 'instagram-story' } as typeof input.media[number]);
    const original = structuredClone(input);
    const parsed = parseOpeningsBridge(input);
    if (!parsed) throw new Error('Expected valid manifest');
    expect(parsed.media.map((media) => media.role)).toEqual(['opengraph', 'instagram-story']);
    expect(input).toEqual(original);
    if (input.media[0]) input.media[0].width = 1;
    expect(parsed.media[1]?.width).toBe(1200);
  });
  it.each([
    { schemaVersion: 2 }, { tenant: 'equity' }, { jobId: '' }, { jobId: 'x'.repeat(257) },
    { entityRevision: '\n' }, { entityRevision: 'x'.repeat(257) }, { entityContentSha256: 'A'.repeat(64) },
    { generation: 0 }, { generation: 1.5 }, { generation: Number.MAX_SAFE_INTEGER + 1 },
    { media: [] }, { unknown: true },
  ])('rejects invalid root fields %j', (change) => {
    expect(parseOpeningsBridge({ ...manifest(), ...change })).toBeNull();
  });
  it.each([
    { role: 'other' }, { artifactId: 'short' }, { sha256: 'B'.repeat(64) }, { byteSize: 0 },
    { byteSize: 50_000_001 }, { byteSize: 1.1 }, { mediaType: 'video/mp4' },
    { width: 8193 }, { height: 0 }, { width: 1.1 }, { renderVersion: '01' },
    { renderVersion: '0' }, { renderVersion: '1'.repeat(33) }, { unknown: true },
  ])('rejects invalid media fields %j', (change) => {
    const input = manifest();
    expect(parseOpeningsBridge({ ...input, media: [{ ...input.media[0], ...change }] })).toBeNull();
  });
  it('rejects duplicate roles and accepts video only with MP4', () => {
    const input = manifest();
    expect(parseOpeningsBridge({ ...input, media: [...input.media, ...input.media] })).toBeNull();
    expect(parseOpeningsBridge({ ...input, media: [{ ...input.media[0], role: 'social-video', mediaType: 'video/mp4' }] })).not.toBeNull();
  });
});
