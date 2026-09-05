import { describe, expect, it, vi } from 'vitest';

import type { PublicationEnvelope } from '@trebla/publishing-contracts';

import { verifyTemporaryArtifacts } from './verify-uploads.js';

const sha256 = 'a'.repeat(64);
const locator = `temporary/troco/campaign/${sha256}.mp4`;
const envelope = {
  schemaVersion: 1,
  identity: { tenant: 'troco', sourceType: 'campaign', sourceId: 'one', revision: 'rev', idempotencyKey: 'idem' },
  canonical: { title: 'Campaign', language: 'pt-BR' },
  artifacts: [{ id: 'video', storage: 'r2-temporary', sha256, byteSize: 5, mediaType: 'video/mp4', locator }],
  deliveries: [{ id: 'shadow', adapter: 'social.shadow', operation: 'compare', required: false, payload: { type: 'social.post', text: 'Copy' } }],
} satisfies PublicationEnvelope;

function checksum(value: string): ArrayBuffer {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16)).buffer;
}

describe('temporary artifact intake verification', () => {
  it('requires matching available ledger and R2 metadata', async () => {
    const statement = { bind: vi.fn(), first: vi.fn().mockResolvedValue({ id: 'upload-1' }) };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement) };
    const bucket = { head: vi.fn().mockResolvedValue({
      size: 5,
      customMetadata: { sha256, tenant: 'troco', mediaType: 'video/mp4' },
      checksums: { sha256: checksum(sha256) },
    }) };

    await expect(verifyTemporaryArtifacts(database, bucket, 'troco', envelope)).resolves.toBe(true);
    expect(statement.bind).toHaveBeenCalledWith('troco', locator, sha256, 5, 'video/mp4');
  });

  it('fails closed when either ledger or object metadata differs', async () => {
    const statement = { bind: vi.fn(), first: vi.fn().mockResolvedValue(null) };
    statement.bind.mockReturnValue(statement);
    const database = { prepare: vi.fn().mockReturnValue(statement) };
    const bucket = { head: vi.fn() };

    await expect(verifyTemporaryArtifacts(database, bucket, 'troco', envelope)).resolves.toBe(false);
    expect(bucket.head).not.toHaveBeenCalled();
  });

  it('does not access storage for envelopes with no temporary artifacts', async () => {
    const database = { prepare: vi.fn() };
    const bucket = { head: vi.fn() };
    await expect(verifyTemporaryArtifacts(database, bucket, 'troco', {
      ...envelope, artifacts: [],
    })).resolves.toBe(true);
    expect(database.prepare).not.toHaveBeenCalled();
    expect(bucket.head).not.toHaveBeenCalled();
  });
});
