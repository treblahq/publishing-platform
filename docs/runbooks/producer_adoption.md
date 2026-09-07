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

After a product writes a `{ envelope, uploads }` handoff JSON file, the shared
CLI can validate and queue it locally without any endpoint or credential:

```sh
publishing stage ./handoff.json --outbox ./.publishing/outbox
```

The command exits before reading `PUBLISHING_ENDPOINT` or
`PUBLISHING_ADMIN_TOKEN`. Keep both the handoff file and outbox directory out
of Git because the handoff contains product-owned local artifact paths.

```ts
import {
  createFileOutbox,
  createLocalProducer,
  prepareArtifactReference,
  stagePlatformHandoff,
  uploadPlatformHandoff,
} from '@trebla/publishing';

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
    operation: 'compare',
    required: false,
    payload: { type: 'social.post', text: 'Final approved copy', artifactIds: ['social-video'] },
  }],
});
```

Product adapters should return `{ envelope, uploads }`, keeping each private
local path beside its public artifact reference rather than inside the
envelope. The shared coordinator then enforces the same sequence for every
product:

```ts
const entry = await stagePlatformHandoff(handoff, producer); // local disk only
const upload = await uploadPlatformHandoff(handoff, uploader);
if (upload.outcome !== 'available') return; // retain bytes and outbox entry
// Submit this exact envelope; a shared outbox can contain unuploaded work.
const result = await client.submit(handoff.envelope);
if (result.outcome === 'accepted') await outbox.acknowledge(entry.id, result.publicationId);
```

`stagePlatformHandoff` cannot perform a network request. Upload bindings must
cover every temporary artifact exactly once. Uploads run sequentially and stop
at the first capacity deferral, so one product cannot create an uncontrolled
burst against the free allowance.

The outbox path is product-owned runtime state. Do not place it inside Git or
commit generated media.

The 0.1.1 release candidate provides `createPlatformPublisher` to coordinate
this entire sequence and retain accepted receipts. Until it is published, the
repository-built private CLI can exercise the same implementation:

```sh
node apps/cli/dist/main.js submit /absolute/handoff.json --tenant troco --outbox /absolute/private-outbox
```

Use `PUBLISHING_ENDPOINT`, `PUBLISHING_CLIENT_ID`, and
`PUBLISHING_CLIENT_SECRET` from a private environment. No administrative token
is required. This rollout command rejects other tenants, non-shadow adapters,
and artifacts larger than 50 MiB before submission; capacity deferrals exit 75.
It does not enable a tenant or transfer live delivery ownership.

## Submission gate

Submission is a separate, explicit operation. Construct a
`createPublishingClient` with environment-provided `PUBLISHING_BASE_URL`,
`PUBLISHING_CLIENT_ID`, and `PUBLISHING_CLIENT_SECRET`, then pass it to
`createLocalProducer` before calling `drain`.

For each `r2-temporary` artifact, construct `createArtifactUploader` with the
same environment-provided endpoint and credentials. Upload the local file
before draining its envelope. The uploader recalculates both the local size
and SHA-256 hash before making a request, signs the verified hash, and streams
the file without loading it all into memory. A file changed after preparation
is rejected locally even when its replacement has exactly the same size.

The required order is:

1. Prepare and durably save the envelope locally.
2. Upload every temporary artifact using its exact content-addressed locator.
3. Retry only results marked `retry-later`; stop on conflicts or malformed
   responses.
4. Drain the envelope only after every upload is `available`.
5. Keep the local media until the platform accepts the envelope and the local
   accepted record is durable.

```ts
import { createArtifactUploader } from '@trebla/publishing';

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

The production configuration enables `web.r2,social.shadow`. Other providers
remain disabled. Social producer signing keys are installed separately in
`SOCIAL_PRODUCER_SECRETS`; duplicate client IDs across the primary and social
maps fail closed instead of replacing an existing producer credential.
It has no provider transport, credential, or write capability. It validates the
final provider-neutral post and records a deterministic shadow receipt.
Once that receipt is durable, its artifact reference is safe to delete: the
comparison has finished and no provider downloads the bytes. Other delivery
references can still keep the same object protected. Unconfirmed comparisons
retain their files.

For each product, use this rollout order:

1. validate its isolated integration branch locally;
2. create a tenant-scoped producer credential without enabling provider access;
3. enable only `social.shadow` for that tenant;
4. submit one bounded handoff and verify its deterministic receipt;
5. observe the queues and free-tier counters before onboarding another product.

Compiling or enabling `social.shadow` does not enable OneSignal or any social
network. A live provider adapter requires a separate reviewed rollout and an
explicit transfer of delivery ownership from the existing publisher.

## Repository and secret boundaries

### Openings rollout status (2026-09-07)

The Openings social publisher submits `social.shadow` from its production
bridge, using the separate `openings-social-publisher` credential. A bounded
11,652-byte image smoke test reached `verified` in the production queue and its
artifact reference was marked safe to delete. Repeating the same local handoff
returned `already-accepted` without another network request.

The Worker source now includes a text/link `social.mastodon` adapter, but it is
not enabled in production. Its access token must come from the
`MASTODON_ACCESS_TOKENS` Worker secret (JSON mapping tenant IDs to tokens), never
from `ADAPTER_CONFIGS`. The adapter confirms the authenticated account, checks
recent posts for the exact canonical URL, and records a sanitized receipt.
Mastodon's [idempotency keys expire after at most one hour](https://docs.joinmastodon.org/methods/statuses/#create),
so lost POST responses enter reconciliation instead of blind retry. A bounded
search that finds nothing returns `unknown`, not proof that publication failed.

The authenticated `GET /v1/publications/:id` endpoint returns delivery states
and sanitized receipts only to the producer that owns the publication. The
Openings CLI exposes this as `platform status --publication ID`.

Before enabling Mastodon, configure its Worker credential and switch that
channel's legacy executor to submit work and wait for its receipt in one coordinated change. Do not
enable both owners for the same scheduled post. Media attachments and the other
social providers remain separate rollout work.

The Openings integration branch now includes that exclusive executor switch,
`PUBLISHING_MASTODON_ENABLED`, defaulting to false. When enabled it removes the
legacy token requirement, submits one text/link publication, and waits for a
verified receipt. Pending or ambiguous results never fall back to a native
provider POST. This switch has not been enabled in production.

Before submission, the workflow commits and pushes a per-job Cloudflare owner
marker in the tracked queue. Only never-attempted, never-reset jobs are claimed;
legacy ambiguous attempts require reconciliation instead of automatic transfer.
Pending acceptance IDs are retained in that queue, survive manual retry resets,
and resume through status reads on a fresh runner. Disabling the global switch
does not authorize the legacy executor to take a cloud-owned job.

The attempted encrypted Mastodon credential-transfer dispatch was rejected by
automatic security review before execution. No credential was exported. Its
explicit authorization and installation remain prerequisites for live cutover.

Focused local adoption checks also pass for Trebla (17 request, qualification
and handoff tests), Troco (4), Turma do Kako (4), and Equity (4). These checks
do not establish live delivery: product dependencies remain at 0.1.0 and those
four products have not been moved to a new provider owner by this change.

- Keep signing secrets and provider credentials in environment variables or
  the product's existing secret store.
- Commit only variable names and placeholder examples.
- Never commit generated media, outbox entries, signed URLs, raw provider
  responses, or publication state.
- Do not add automatic workflow triggers during adoption. Staging validation
  remains manual until local checks are green.
- Stop before any configured free-tier safety threshold; there is no paid
  fallback.
