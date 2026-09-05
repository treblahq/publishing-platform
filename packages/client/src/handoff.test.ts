import { describe, expect, it, vi } from 'vitest';
import type { ArtifactReference, PublicationEnvelope } from '@trebla/publishing-contracts';
import type { ArtifactUploader } from './upload.js';
import { stagePlatformHandoff, uploadPlatformHandoff } from './handoff.js';

const artifact = (id: string): ArtifactReference => ({
  id, storage: 'r2-temporary', sha256: id.repeat(64).slice(0, 64), byteSize: 10,
  mediaType: 'video/mp4', locator: `temporary/troco/campaign/${id.repeat(64).slice(0, 64)}.mp4`,
});

const envelope = (artifacts: ArtifactReference[]): PublicationEnvelope => ({
  schemaVersion: 1,
  identity: { tenant: 'troco', sourceType: 'campaign', sourceId: 'one', revision: 'rev', idempotencyKey: 'troco:one:rev' },
  canonical: { title: 'Campaign', language: 'pt-BR' }, artifacts,
  deliveries: [{ id: 'social', adapter: 'social.shadow', operation: 'compare', required: false, payload: { type: 'social.post', text: 'Copy' } }],
});

describe('platform handoff coordinator', () => {
  it('durably stages an envelope without invoking an uploader', async () => {
    const prepare = vi.fn().mockResolvedValue({ id: 'entry' });
    const uploader = { upload: vi.fn() };
    const handoff = { envelope: envelope([artifact('a')]), uploads: [{ reference: artifact('a'), filePath: '/tmp/a.mp4' }] };

    await expect(stagePlatformHandoff(handoff, { prepare })).resolves.toEqual({ id: 'entry' });
    expect(prepare).toHaveBeenCalledWith(handoff.envelope);
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it('uploads sequentially and stops safely on a deferred artifact', async () => {
    const first = artifact('a');
    const second = artifact('b');
    const upload = vi.fn<ArtifactUploader['upload']>()
      .mockResolvedValueOnce({ outcome: 'retry-later', code: 'FREE_TIER_BUDGET_EXHAUSTED', retryAfter: 'tomorrow' });
    const handoff = { envelope: envelope([first, second]), uploads: [
      { reference: first, filePath: '/tmp/a.mp4' },
      { reference: second, filePath: '/tmp/b.mp4' },
    ] };

    await expect(uploadPlatformHandoff(handoff, { upload })).resolves.toEqual({
      outcome: 'retry-later', uploaded: 0, code: 'FREE_TIER_BUDGET_EXHAUSTED', retryAfter: 'tomorrow',
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('rejects a handoff whose upload bindings do not exactly cover temporary artifacts', async () => {
    const first = artifact('a');
    await expect(uploadPlatformHandoff({
      envelope: envelope([first]), uploads: [],
    }, { upload: vi.fn() })).rejects.toThrow('exactly cover');
  });
});
