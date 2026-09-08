# Atomic Upload Acceptance Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and test-driven-development. Platform main is authorized; no deployment or production database write.

**Goal:** Prevent accepting a publication after its verified temporary upload has become unavailable.

**Architecture:** Existing intake validates storage before its transaction. Recheck exact upload identity and availability inside the artifact insertion itself. A failed lookup supplies NULL to the existing NOT NULL locator constraint, aborting the entire D1 batch before references or publication acceptance survive. No new schema, paid service, extra preflight query or provider call.

**Tech Stack:** TypeScript and real SQLite tests using all platform migrations.

## Verified execution

Implemented in commit `18a47ae`. The pre-fix suite reproduced 16 failures;
24 added regressions now pass, including both actual cleanup orderings and
multi-artifact rollback. Independent review found no actionable issues.
Fresh full verification passed 652 tests across 91 files, lint, typecheck and
secret scan; the implementation agent also verified build. No schema or
production operation changed. The checklist below records the executed design.

## Task 1: Reproduce and fence the acceptance race

Modify `apps/worker/src/intake/d1-intake-store.ts`; create
`apps/worker/src/intake/d1-intake-upload-fencing.test.ts`.

- [ ] Seed a real SQLite database with enabled tenant/producer and a matching available temporary upload plus its capacity reservation. Adapt prepared statements and atomic batches to the existing D1 interface, using BEGIN/COMMIT/ROLLBACK.
- [ ] Write a failing regression proving the store rejects an upload changed to `failed` after preflight, and that nonces, publications, source leases, artifacts, deliveries, references, reservations, audit and outbox additions roll back. Compare existing seeded state before/after, preserving the upload's external cleanup transition.
- [ ] Run `npm run test:prepared -- apps/worker/src/intake/d1-intake-upload-fencing.test.ts`; confirm current acceptance incorrectly succeeds. Preserve a positive available-upload acceptance case.
- [ ] For `r2-temporary` only, insert locator through a scalar subquery instead of blindly binding it. Preserve normal external/live artifact insertion.

```sql
(SELECT locator FROM artifact_uploads
 WHERE tenant_id = ? AND locator = ? AND sha256 = ? AND byte_size = ?
   AND media_type = ? AND deleted_at IS NULL
   AND (state = 'claimed' OR (state = 'available' AND julianday(expires_at) > julianday(?)))
 LIMIT 1)
```

- [ ] Bind the authenticated tenant, exact artifact identity and transaction acceptance timestamp. The subquery returns NULL when unavailable; the artifacts.locator NOT NULL constraint must abort the batch, not permit a partial silent success. Retain existing tenant-level sharing semantics; do not invent a new producer ownership restriction.
- [ ] Keep the following upload-claim UPDATE consistent with that predicate. Since insertion and claim share the batch transaction, cleanup cannot intervene between them. Already claimed uploads use reference lifetime, not expired upload TTL; normal idempotency/unique artifact rules remain unchanged.
- [ ] Test missing, uploading, failed, deleted, expired available, invalid expiry, mismatched hash/size/MIME/tenant and non-null deleted marker. Verify exact available match claims atomically; claimed match is not rejected solely for upload TTL. Test non-temporary artifact compatibility.
- [ ] Exercise the race from real `runD1UploadCleanup`: its bucket callback attempts intake after the cleanup has claimed the row. Intake must reject atomically and cleanup must finish normally. The inverse order must retain the claimed upload without bucket deletion.
- [ ] Run focused intake/cleanup tests, lint, typecheck, build, full tests and secret scan. Review specification and quality before committing. Do not describe this as public gateway activation or historical CPU incident resolution.
