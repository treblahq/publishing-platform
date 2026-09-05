import {
  validatePublicationEnvelope,
  type ArtifactReference,
  type PublicationEnvelope,
} from '@treblahq/publishing-contracts';

import type { FileOutboxEntry } from './outbox.js';
import type { ArtifactUploader } from './upload.js';

export interface PlatformHandoff {
  envelope: PublicationEnvelope;
  uploads: readonly Readonly<{ reference: ArtifactReference; filePath: string }>[];
}

export type PlatformUploadOutcome =
  | { outcome: 'available'; uploaded: number }
  | { outcome: 'retry-later'; uploaded: number; code: string; retryAfter: string | undefined };

export async function stagePlatformHandoff(
  handoff: PlatformHandoff,
  producer: { prepare(envelope: PublicationEnvelope): Promise<FileOutboxEntry> },
): Promise<FileOutboxEntry> {
  const envelope = validateHandoff(handoff);
  return producer.prepare(envelope);
}

export async function uploadPlatformHandoff(
  handoff: PlatformHandoff,
  uploader: ArtifactUploader,
): Promise<PlatformUploadOutcome> {
  const envelope = validateHandoff(handoff);
  let uploaded = 0;
  for (const binding of handoff.uploads) {
    const result = await uploader.upload({
      tenant: envelope.identity.tenant,
      reference: binding.reference,
      filePath: binding.filePath,
    });
    if (result.outcome === 'retry-later') {
      return { ...result, uploaded };
    }
    uploaded += 1;
  }
  return { outcome: 'available', uploaded };
}

function validateHandoff(handoff: PlatformHandoff): PublicationEnvelope {
  const envelope = validatePublicationEnvelope(handoff.envelope);
  const temporary = envelope.artifacts.filter(({ storage }) => storage === 'r2-temporary');
  if (handoff.uploads.length !== temporary.length) {
    throw new Error('Platform upload bindings must exactly cover temporary artifacts');
  }
  const expected = new Map(temporary.map((reference) => [reference.id, reference]));
  const seen = new Set<string>();
  for (const binding of handoff.uploads) {
    const reference = expected.get(binding.reference.id);
    if (!reference || seen.has(reference.id) || JSON.stringify(reference) !== JSON.stringify(binding.reference)
      || typeof binding.filePath !== 'string' || binding.filePath.trim() === '') {
      throw new Error('Platform upload bindings must exactly cover temporary artifacts');
    }
    seen.add(reference.id);
  }
  return envelope;
}
