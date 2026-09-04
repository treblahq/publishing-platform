export { canonicalRequest, signCanonicalRequest } from './sign.js';
export { buildSignedHeaders, sha256Hex } from './headers.js';
export { createPublishingClient } from './client.js';

export type { CanonicalRequestInput } from './sign.js';
export type { SignedHeadersInput } from './headers.js';
export type {
  PublishingClient,
  PublishingClientOptions,
  SubmissionResult,
} from './client.js';
