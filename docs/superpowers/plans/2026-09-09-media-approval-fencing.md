# Media Approval Fencing Implementation Plan

> Use subagent-driven development, test-first implementation and independent
> specification then quality review. Do not wire routes or deploy.

## Goal and approved boundary

Complete the grant-creation side of the approved publication-media gateway.
Cleanup already protects unsafe references with receipts or grants. An internal
issuer must insert an approval only while its artifact is still available and
the requesting delivery owns a current lease. Public HTTP remains disabled.

Create only `apps/worker/src/artifacts/d1-public-media-approval.ts` and its
`.test.ts`. Use existing migration 0009, not a second approval table. The issuer
is an internal trusted application boundary, not an authenticated HTTP endpoint.
No secrets, native ownership transfer, real approval, adapter activation or
retention acquisition is part of this change.

## Contract

Export `createD1PublicMediaApprovalStore(database, allowedAdapters, now)` with
`approve(input): Promise<'accepted' | 'replayed' | 'rejected'>`.
Input has exactly tenant, artifactId, sha256, deliveryId, fencingToken, expiresAt.
Use the existing transport identity formats (exclude equity), bounded nonempty
deliveryId (up to 128 ASCII alphanumeric/underscore/hyphen characters), a positive
safe integer fencingToken and canonical UTC ISO expiry strictly after captured
now and at most seven days later. Seven days is a local maximum, not a provider
promise; expiry never proves ingestion. Reject unknown fields, malformed input,
invalid clock and empty adapter allowlist before SQL. Copy/deduplicate the trusted
allowlist and exclude social.shadow; never infer approval from missing controls.

An atomic INSERT SELECT must require same-tenant enabled tenant, delivery,
reference and artifact; unsafe reference; exact artifact hash; temporary storage;
available state with null tombstone/deletion; PNG/JPEG/MP4; safe integer byte size
1..50000000; transport-compatible private temporary locator. Delivery adapter must
be in the explicit allowlist with enabled adapter control, state delivering,
processing or reconciling, exact fencing token and lease_expires_at strictly
after now. Store approved_at as the one captured current time and requested
expires_at. An invalid or expired lease denies. Bind all data values.

Use ON CONFLICT DO NOTHING and RETURNING for insertion. Do not update existing
grants. If no row was inserted, a bounded SELECT may recognize only the exact
same expiry and identity, unrevoked/current approval and the same live eligibility
predicate. Return replayed without changing approved_at or expiry. Different
expiry, stale owner, released reference, revoked/expired approval and unavailable
artifact reject, with no stale fallback or resurrection. Unexpected database
failure throws a fixed generic diagnostic, with no retry/refund/recovery write.
Never change entity, artifact, reference, delivery, lease or receipt tables.

## TDD execution

- [x] Reproduce missing issuance with a real SQLite fixture loading all migrations.
  Use existing public-media resolver tests for fixture/interface patterns.
- [x] Implement the internal issuer with atomic availability and lease conditions.
- [x] Prove accepted exact grant; immutable exact replay; conflicting expiry,
  released/stale/expired/missing lease; wrong/disabled tenant and adapter; shadow
  and Equity denial; cross-tenant records; hash/size/MIME/locator mismatch;
  malformed runtime inputs; no mutation of retention or lease state.
- [x] Exercise both races through actual SQL and the real cleanup function:
  approval before tombstone prevents deletion; tombstone before approval prevents
  insertion, including retry after a failed bucket deletion. No actual bucket.
- [x] Prove lost INSERT response followed by fresh exact retry yields replay
  without duplicate grants or timestamp extension. Compose issued approval with
  the actual resolver; released reference revokes effective access without
  reauthorizing or restoring bytes.
- [x] Focused tests, targeted lint and independent reviews before full validation.
- [x] Root runs full platform validation, records evidence/remaining gates and
  commits only reviewed files with skip-CI marker. No public route activation.

This does not close account allocation provisioning, denial cost bounds, native
provider ownership, full gateway HTTP integration or Free CPU acceptance.
