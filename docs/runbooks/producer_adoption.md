# Producer Adoption

> How product-owned publishers can prepare durable publication work locally without consuming cloud or provider quota.

The publishing client separates preparation from submission. A product can
hash media, validate an immutable publication envelope, and persist it in a
local outbox without configuring a platform endpoint or signing secret.

## Local preparation flow

1. Finish the product-owned trigger, copy, approval, and rendering steps.
2. Inspect each local file with `prepareArtifactReference`.
3. Build a versioned `PublicationEnvelope` with final content and artifact
   metadata only.
4. Call `createLocalProducer({ outbox }).prepare(envelope)`.
5. Keep the source bytes and the local outbox entry until later upload and
   platform acceptance have both been confirmed.

Preparation performs no HTTP request. It does not upload media, submit the
envelope, run a GitHub Action, publish to a provider, or transfer delivery
ownership.

```ts
import {
  createFileOutbox,
  createLocalProducer,
  prepareArtifactReference,
  stagePlatformHandoff,
  uploadPlatformHandoff,
} from '@treblahq/publishing-client';

const artifact = await prepareArtifactReference({
  id: 'social-video',
  filePath: '/absolute/product-owned/output/video.mp4',
  storage: 'r2-temporary',
  locator: (sha256) => `temporary/troco/campaign-id/${sha256}.mp4`,
  mediaType: 'video/mp4',
  allowedMediaTypes: ['video/mp4'],
  maxByteSize: 50 * 1024 * 1024,
});

const producer = createLocalProducer({
  outbox: createFileOutbox('/absolute/product-owned/state/platform-outbox'),
});

await producer.prepare({
  schemaVersion: 1,
  identity: {
    tenant: 'troco',
    sourceType: 'campaign',
    sourceId: 'campaign-id',
    revision: 'approved-revision',
    idempotencyKey: 'troco:campaign:campaign-id:approved-revision',
  },
  canonical: { title: 'Approved campaign', language: 'pt-BR' },
  artifacts: [artifact],
  deliveries: [{
    id: 'social',
    adapter: 'social.shadow',
    operation: 'publish',
    required: false,
    payload: { type: 'social.post', text: 'Final approved copy' },
  }],
});
```

Product adapters should return `{ envelope, uploads }`, keeping each private
local path beside its public artifact reference rather than inside the
envelope. The shared coordinator then enforces the same sequence for every
product:

```ts
await stagePlatformHandoff(handoff, producer); // local disk only
const upload = await uploadPlatformHandoff(handoff, uploader);
if (upload.outcome !== 'available') return; // retain bytes and outbox entry
await producer.drain({ limit: 25 });
```

`stagePlatformHandoff` cannot perform a network request. Upload bindings must
cover every temporary artifact exactly once. Uploads run sequentially and stop
at the first capacity deferral, so one product cannot create an uncontrolled
burst against the free allowance.

The outbox path is product-owned runtime state. Do not place it inside Git or
commit generated media.

## Submission gate

Submission is a separate, explicit operation. Construct a
`createPublishingClient` with environment-provided `PUBLISHING_BASE_URL`,
`PUBLISHING_CLIENT_ID`, and `PUBLISHING_CLIENT_SECRET`, then pass it to
`createLocalProducer` before calling `drain`.

For each `r2-temporary` artifact, construct `createArtifactUploader` with the
same environment-provided endpoint and credentials. Upload the local file
before draining its envelope. The uploader verifies that the local size still
matches the prepared reference, signs the already-computed hash, and streams
the file without loading it all into memory.

The required order is:

1. Prepare and durably save the envelope locally.
2. Upload every temporary artifact using its exact content-addressed locator.
3. Retry only results marked `retry-later`; stop on conflicts or malformed
   responses.
4. Drain the envelope only after every upload is `available`.
5. Keep the local media until the platform accepts the envelope and the local
   accepted record is durable.

```ts
import { createArtifactUploader } from '@treblahq/publishing-client';

const uploader = createArtifactUploader({
  baseUrl: process.env.PUBLISHING_BASE_URL!,
  clientId: process.env.PUBLISHING_CLIENT_ID!,
  secret: process.env.PUBLISHING_CLIENT_SECRET!,
});

const uploaded = await uploader.upload({
  tenant: 'troco',
  reference: artifact,
  filePath: '/absolute/product-owned/output/video.mp4',
});
if (uploaded.outcome !== 'available') {
  // Leave the local outbox entry and source file intact for a later bounded retry.
  return;
}
await producer.drain({ limit: 25 });
```

The Worker independently verifies the checksum, byte size, media type, tenant,
and locator in R2 before publication intake can claim the upload. Repeating an
identical upload or envelope is safe. Reusing a locator with different metadata
is rejected.

The drain operation is bounded to at most 100 entries per call:

- accepted entries move to the outbox `accepted` directory;
- capacity-deferred entries remain pending;
- network and server failures remain pending;
- repeated attempts reuse the envelope idempotency key.

Dry runs must omit the publishing client entirely. This makes an accidental
network write structurally unavailable during preparation.

## Temporary media ownership

The product owns the original bytes while work is local. After the upload flow
verifies an R2 object, the platform may retain that temporary copy
only until every referencing provider confirms ingestion. An API acceptance
response is not sufficient when a provider downloads or processes media
asynchronously.

After safe deletion, D1 keeps only metadata and delivery receipts. The product
may remove its local generated file according to its own retention policy once
platform acceptance and recovery requirements are satisfied.

Uploads that fail or remain unclaimed past their 24-hour expiry are collected
in bounded scheduled batches. Claimed uploads and artifacts with ambiguous or
active provider references remain protected. Temporary bytes are counted once:
as an available upload before intake, then as an artifact after intake.

## Product adoption order

Adopt one product and one non-writing shadow delivery at a time:

1. Openings, reusing its existing envelope builder and keeping OneSignal
   disabled.
2. Troco, preserving campaign state and rendering ownership.
3. Trebla, preserving human review and GitHub editorial reconciliation.
4. Turma do Kako, after its current working tree is clean, preserving narrative
   production and fail-closed approval rules.
5. Equity, through a local executor that keeps YouTube OAuth material outside
   the platform.

Each product must pass local validation and a zero-network dry run before any
staging submission. Live ownership remains with the legacy publisher until a
separate cutover explicitly pauses the old owner and reconciles in-flight work.

## Repository and secret boundaries

- Keep signing secrets and provider credentials in environment variables or
  the product's existing secret store.
- Commit only variable names and placeholder examples.
- Never commit generated media, outbox entries, signed URLs, raw provider
  responses, or publication state.
- Do not add automatic workflow triggers during adoption. Staging validation
  remains manual until local checks are green.
- Stop before any configured free-tier safety threshold; there is no paid
  fallback.
