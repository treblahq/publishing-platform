# Public media runtime integration

Continue the approved publication-media gateway design with test-first
implementation and independent specification then quality reviews. Use the
existing isolated platform repository/main authorized by the user. Do not deploy,
provision allocations, issue approvals, change Wrangler variables or activate
providers. Existing CPU and account-allocation gates remain mandatory.

## Contract

Connect `/media/` in the real `createWorker().fetch` router to a small runtime
handler composing the existing public transport, D1 admission and D1 grant
resolver. Do not duplicate their eligibility/retention rules. Adapt native R2
`get(key, { range })` correctly; HEAD remains metadata-only. No public bucket.

Use one optional JSON string environment value `PUBLIC_MEDIA_GATEWAY_CONFIG`,
at most 4096 characters, with exact fields `enabled`, `accountId`,
`allowedAdapters`, `cost`. Only boolean enabled true enables the handler.
accountId is exactly 32 lowercase hexadecimal characters. allowedAdapters is
1..16 unique names matching `social.` plus 1..64 lowercase alphanumeric,
dot/hyphen characters, excluding social.shadow. Cost has exactly d1Reads,
d1Writes, r2ClassB, all safe integers meeting the existing admission floors.
These floors are not certified billing measurements; no defaults or allocation
creation are permitted. Unknown fields, malformed/missing config, missing native
bindings or malformed binding methods fail closed with generic empty responses.

Missing/disabled config returns 404 without touching D1/R2. Invalid enabled
configuration returns 503 without touching D1/R2. Exact response headers match
the transport's no-store/nosniff denial. Invalid public paths/methods/queries and
Equity retain existing transport denial before admission. Bindings only require
the LEDGER and ARTIFACTS actually used, not queues or secret-bearing adapters.
Do not register an override that can bypass admission. Do not alter other routes,
scheduled/queue behavior, approvals, references, receipts or provider ownership.

## Verification

- [x] Test first through actual createWorker().fetch, using real SQLite migrations
  and a native-shape fake R2 boundary. Observe intended behavior RED.
- [x] Prove approved PNG GET/HEAD and MP4 range support, using actual issuer and
  resolver, real finite allocation counters and a real same-tenant delivery lease.
- [x] Prove missing/disabled/invalid config and unsupported requests cause no
  database/bucket work. Missing/depleted allocation cannot reach R2 or grant reads.
- [x] Prove released/unapproved/cross-tenant media denial, mismatched R2 metadata
  denial, and upstream failure 503 without exception/locator/config disclosure.
- [x] Prove new callers share the same finite allocation, and reservations are
  neither retried nor refunded on response loss or downstream failure.
- [x] Focused tests, spec review, quality review, then root full validation.
- [x] Record actual evidence and push reviewed implementation with skip-CI.

Implementation scope: new `apps/worker/src/artifacts/public-media-runtime.ts`
and `.test.ts`, and the minimal import/router dispatch in `apps/worker/src/index.ts`.
No generated runtime settings or production deployment are part of this task.
Runtime composition is not final Free certification or native-provider cutover.

## Verification evidence

The approved PNG integration test initially returned 404 instead of 200.
The completed focused suite passes 98 tests. Full validation first caught an
optional-header typing error in the test helper; after correction it passes
1,189 tests across 100 files, build, lint, typecheck and known-secret scanning.
Independent specification and quality reviews found no blocking findings.
No Wrangler configuration, allocation, provider activation or deployment changed.
Reviewed implementation was pushed to main as `8e50b75` with skip-CI.
