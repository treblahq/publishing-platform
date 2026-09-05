export { canonicalRequest, signCanonicalRequest } from './sign.js';
export { buildSignedHeaders, buildSignedHeadersFromHash, sha256Hex } from './headers.js';
export { createPublishingClient } from './client.js';
export { createFileOutbox } from './outbox.js';
export { prepareArtifactReference } from './artifacts.js';
export { createLocalProducer } from './producer.js';
export { createArtifactUploader } from './upload.js';
export { stagePlatformHandoff, uploadPlatformHandoff } from './handoff.js';

export type { CanonicalRequestInput } from './sign.js';
export type { SignedHeadersInput } from './headers.js';
export type { PreHashedSignedHeadersInput } from './headers.js';
export type {
  PublishingClient,
  PublishingClientOptions,
  SubmissionResult,
} from './client.js';
export type { FileOutbox, FileOutboxEntry } from './outbox.js';
export type { PrepareArtifactReferenceInput } from './artifacts.js';
export type {
  DrainResult,
  LocalProducer,
  LocalProducerOptions,
} from './producer.js';
export type {
  ArtifactUploader,
  ArtifactUploaderOptions,
  ArtifactUploadResult,
} from './upload.js';
export type { PlatformHandoff, PlatformUploadOutcome } from './handoff.js';
