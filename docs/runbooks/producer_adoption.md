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

The published 0.1.1 release provides `createPlatformPublisher` to coordinate
this entire sequence and retain accepted receipts. The repository-built private
CLI can exercise the same implementation:

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

The production configuration enables `web.r2,social.shadow,social.mastodon` for
the approved Openings rollout. Other providers remain disabled. Social producer signing keys are installed separately in
`SOCIAL_PRODUCER_SECRETS`; duplicate client IDs across the primary and social
maps fail closed instead of replacing an existing producer credential.
The shadow adapter has no provider transport, credential, or write capability. It validates the
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

The text/link `social.mastodon` adapter is enabled in production for Openings.
Its access token must come from the
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
provider POST. The switch is now enabled in production after the reviewed
executor was merged into `main`.

Before submission, the workflow commits and pushes a per-job Cloudflare owner
marker in the tracked queue. Only never-attempted, never-reset jobs are claimed;
legacy ambiguous attempts require reconciliation instead of automatic transfer.
Pending acceptance IDs are retained in that queue, survive manual retry resets,
and resume through status reads on a fresh runner. Disabling the global switch
does not authorize the legacy executor to take a cloud-owned job.

After explicit authorization, the existing Mastodon credential was transferred
through an encrypted temporary artifact and verified against account
`openingshq`. The Worker secret was installed; the temporary GitHub artifact,
downloaded ciphertext, and ephemeral private key were deleted. The original
GitHub secret remains preserved for legacy work and recovery.

Worker version `a65f1634-71b4-4839-8c06-d5f62f39ad76` deployed successfully
from platform commit `a1d1e95`, without GitHub Actions. Openings executor commit
`3d866bb` is on `main`, and `PUBLISHING_MASTODON_ENABLED=true` was read back
after activation. The site, Worker health, and one existing job, author and
community passed post-deploy checks with exact entity revisions. Local platform
validation passed 348 tests. The web runtime now passes the Mastodon secret to
configuration parsing, preventing social activation from breaking web routes.

No extra scheduled run or test post was dispatched. The first eligible live
Mastodon delivery and its provider receipt are still pending confirmation;
activation is not evidence of a completed provider post. Existing legacy
attempts are not automatically transferred. OneSignal remains disabled.

Focused local adoption checks also pass for Trebla (17 request, qualification
and handoff tests), Troco (4), Turma do Kako (4), and Equity (4). These checks
do not establish live delivery: version 0.1.1 is now published and the isolated
product branches passed dependency-upgrade validation. Those four
products have not been moved to a new provider owner by the package upgrade.

The verified dependency-upgrade checkpoints are:

| Product | Integration commit | Local verification |
| --- | --- | --- |
| Openings | `2a5ef20` | 19 platform tests, 29 artwork/state tests, 165 contracts; 4 existing skipped tests |
| Trebla | `fb08fff` | 1,442 tests, lint, build, three publication safety checks |
| Troco | `fe2cd32` | 189 tests, formatting, types, catalog/provider validation |
| Turma do Kako | `83088d1` | 1,231 tests, types, lint |
| Equity | `8e595c1` | 363 tests and types |

These are historical dependency-upgrade checkpoints, not proof of live
provider ownership. Troco's isolated
checks use `BRAND_ROOT` pointing to its existing canonical frontend assets and
the installed, pinned `ffmpeg-static` binary. No provider or deployment workflow
was dispatched for these dependency upgrades.

### Cross-product rollout checkpoint (2026-09-07)

Openings `2a5ef20`, Trebla `44cacdd`, Troco `d67b1c0`, and Equity `8e595c1`
and Kako `0b6feec` are now on their respective remote main branches. Troco's integration was
rebased by selecting only migration changes onto the current main, preserving
upstream publication-state changes. Kako's equivalent integration passed
1,408 tests, type checking, and lint before merge. Original dirty product
directories were not changed.

Equity subsequently merged `cf61b94` after 368 tests and type checking. Its
temporary preparation helper now admits exactly one `final_video` and at most
one intended JPEG thumbnail, excludes intermediate renders, and rejects media
above the Worker upload limit. This prevents accidental cache uploads; it does
not implement or enable Equity's required local YouTube executor.

Trebla and Troco now have real, opt-in shadow bridges in their publication
executors. Their latest complete local checks passed 1,461 and 169 tests,
respectively, plus their existing static and publication-safety checks.
`PUBLISHING_SHADOW_ENABLED` remains false in their private local configuration;
the new credentials have not been wired into scheduled workflows. Legacy
executors remain the only live provider owners for these products.

Four tenant-scoped producers were registered and tested in the existing
production Worker. Each test used one 68-byte technical PNG and the
non-publishing `social.shadow` adapter:

| Tenant | Verified technical publication |
| --- | --- |
| `troco` | `e454e670-a591-4edb-8070-e8324618af77` |
| `trebla` | `e2158d2b-db30-41ad-91d3-a041be41f80f` |
| `turma-do-kako` | `409fbb87-ebe1-4182-ae7b-3ee723db48c3` |
| `equity` | `f1faeedc-2031-4d20-bee8-dc35ee320147` |

All four receipts reached `verified`; repeating their handoffs reused the
accepted publication. These checks prove tenant authentication, upload, queue
processing, and shadow receipts, not end-to-end publication of product content.
An earlier Troco technical test without an artifact failed validation; its
immutable failure history was retained and the corrected fixture used a new
revision.

New social signing keys are stored separately from the existing primary
producer map. The platform's ignored `.env.producers.local` and each product's
ignored `.env.publishing.local` are private, mode-600 files. Only the social
secret map was updated in the Worker; existing provider tokens were preserved.
Explicit tenant controls disable web, Mastodon, and OneSignal deliveries for
the four newly onboarded tenants. No real social post, YouTube upload, GitHub
Action, paid resource, or DNS cutover was triggered by these tests.

The reviewed SDK recovery change in platform commit `a66cf34` probes intake
before opening media. Only `409 ARTIFACT_NOT_READY` permits uploading and
resubmitting the same immutable envelope. An existing acceptance can therefore
be recovered on a fresh executor after temporary media has been deleted.
Accepted-envelope lookup also binds the authenticated producer and exact
content; identity conflicts disclose no publication ID. Worker version
`ffea1548-1241-43a1-aecc-03bd65257bfe` deployed successfully from platform
commit `a2515b2` after 360 passing tests and a successful dry run. No database
migration or GitHub Action was needed. A post-deploy check recovered all four
technical publications from fresh local outboxes with deliberately absent media,
performed zero uploads, and verified fixed conflicts for modified content.
Worker health and the public Openings root both returned HTTP 200.

Package 0.1.2 is now public after the owner completed npm authentication. Its
registry checksum matches the audited archive and a clean Node 20 registry
installation verified the coordinator export. See the release record in
`package_release.md`. Consumers still on 0.1.1 do not have the recovery change.

Openings subsequently merged `17583ab`: its submission path now delegates to
`createPlatformPublisher` instead of maintaining a separate upload/intake loop,
and validates the Openings-only shadow boundary before local accepted recovery.
Verification passed 20 platform tests, 29 artwork/state tests (4 existing skips),
and 165 deterministic contracts. Commit `8369ea2` then adopted public 0.1.2,
with 21 platform tests, 29 artwork/state tests and 165 contracts passing. The
new regression verifies recovery after local media deletion. The previously
inspected scheduled run stopped at a retryable bridge
stage before Mastodon; a matching shadow publication is already verified, but
that does not by itself identify the bridge error or prove a live Mastodon post.

The new Kako runtime bridge remains unmerged in its isolated worktree. Its
private-state persistence and independent pending replay have focused tests.
Review found that invalid new media could prevent older pending work from
replaying; three failing regressions drove a fix that isolates new capture
errors. Public 0.1.2 is pinned in the worktree and reproducible full verification
is in progress. Do not enable the bridge before that verification and integration.

After explicit user authorization, the three producer credentials were installed
and their names verified in GitHub Actions Secrets for
`treblahq/social-publisher`, `trocohq/social-publisher`, and
`turmadokako/social-publisher`. Each repository's `PUBLISHING_SHADOW_ENABLED`
variable remains `false`. No workflow was dispatched by this setup and no
credential was added to public code. Equity's credentials remain local.

Remaining rollout gates include updating consumers to the reviewed recovery
release, verifying product-level restart behavior, adding Kako's runtime bridge,
and implementing Equity's durable local executor. Equity's YouTube OAuth and
large video files must remain local; a generic temporary-upload bridge is not
a replacement for that executor. Live provider ownership for Trebla, Troco,
Kako, and Equity has not transferred. Openings still needs confirmation of its
first eligible live Mastodon receipt, and OneSignal remains out of scope.

- Keep signing secrets and provider credentials in environment variables or
  the product's existing secret store.
- Commit only variable names and placeholder examples.
- Never commit generated media, outbox entries, signed URLs, raw provider
  responses, or publication state.
- Do not add automatic workflow triggers during adoption. Staging validation
  remains manual until local checks are green.
- Stop before any configured free-tier safety threshold; there is no paid
  fallback.
