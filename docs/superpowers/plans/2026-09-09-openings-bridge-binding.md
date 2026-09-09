# Immutable Openings bridge binding

Execute the already-approved publication-media-gateway design locally. Do not
enable a route, change a producer, apply a remote migration or dispatch a post.

## Contract

Add an internal Worker-domain manifest validator for a job bridge, separate from
the pipeline-owned web entity. Exact root fields: schemaVersion 1, tenant
`openings`, jobId, entityRevision, entityContentSha256, generation, media. Job ID
and revision are nonempty bounded strings with no control characters. Generation
is a positive safe integer. Media is a nonempty array of at most four distinct
roles: `opengraph`, `instagram-feed`, `instagram-story`, `social-video`.
Each exact media record contains role, artifactId, sha256, byteSize, mediaType,
width, height, renderVersion. Images accept PNG/JPEG and video only MP4; role and
MIME must agree. IDs/hashes/size use the existing public-media transport limits;
dimensions are positive safe integers up to 8192; renderVersion is a bounded
positive decimal string. Reject all unknown fields. Normalize role ordering and
construct a detached canonical representation, without mutating input.

These fields describe producer-verified media. Validating them is not evidence
of actual image dimensions or provider ingestion, nor permission to expose bytes.

## Durable binding

Add migration 0010 for immutable bridge rows keyed by tenant/job/generation,
storing the entity revision/content hash and canonical manifest identity. The
first generation is 1; every replacement must be exactly latest generation + 1
for that job across entity revisions. Identical replay is allowed only for the
currently latest generation and exact canonical manifest. Earlier generations
cannot be reactivated. This avoids guessing an ordering from opaque source
revision strings.

Implement an internal D1 store using a single conditional write for acceptance,
not a vulnerable read-then-write check. Acceptance must match the current enabled
tenant's active job revision/hash and all listed artifact IDs, hashes, MIME,
sizes, tenant, temporary storage, available state and null tombstone/deletion.
Every artifact must also have a same-tenant unsafe-to-delete reference to a
non-shadow provider delivery in the resolver's existing eligible states, with
an explicit enabled adapter control and membership in the store's trusted,
copied adapter allowlist. An empty allowlist denies without DB work. Do not
infer approval from shadow receipts or general missing-control defaults.
It must not alter the entity, create provider approvals, acquire retention,
extend expiry or resurrect deleted artifacts. Missing/changed entity or artifact
and stale/conflicting generations fail closed with fixed diagnostics.

A read returns only the latest binding when it still matches the current active
entity and eligible artifacts. An older generation must not be selected merely
because the latest is now ineligible. A new entity revision has no inherited
media. Return only the validated canonical manifest, never arbitrary DB columns.

## Test-first verification

Use actual migrations and Node SQLite. Prove initial binding, exact reordered
replay, next generation, conflicting/stale/skipped generations, concurrent
writers, changed/current entity revision, disabled tenant, closed/missing job,
cross-tenant/missing/mismatched/tombstoned/released artifact cases, no stale
fallback, malformed rows and zero mutation of source entity/reference/grant
tables. Characterize write counts and document any additional storage cost; no
backfill or migration application is authorized.

Run focused tests, full platform verification and independent spec then quality
review. This completes only durable revision binding, not approval issuance,
retention race coordination, media exposure, native receipt ownership or CPU
acceptance. Keep these remaining gates visible. Do not publish a new npm version
for an internal Worker-only change.
