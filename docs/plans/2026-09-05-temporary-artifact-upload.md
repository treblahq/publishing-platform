# Temporary Artifact Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload content-addressed temporary media before publication intake, while proving identity, integrity, idempotency, and free-tier headroom.

**Architecture:** Producers sign the declared SHA-256 and stream bytes to one authenticated Worker route. R2 validates the checksum during `put`; D1 records upload state and rejects reservations before the strict capacity boundary. Publication intake verifies the corresponding immutable R2 object and atomically claims its upload record before creating delivery work.

**Tech Stack:** TypeScript, Cloudflare Workers, R2 checksums, D1, existing HMAC client, Vitest.

---

### Task 1: Sign and stream prepared artifacts from the client

**Files:**
- Modify: `packages/client/src/headers.ts`
- Create: `packages/client/src/upload.ts`
- Create: `packages/client/src/upload.test.ts`
- Modify: `packages/client/src/index.ts`

- [ ] Test signed headers built from an already verified hash without buffering bytes again.
- [ ] Test local file size verification before the request.
- [ ] Test one bounded `PUT /v1/artifacts` request with locator, size, type, hash, tenant, client, timestamp, and nonce headers.
- [ ] Test explicit outcomes for stored, already stored, capacity deferred, conflict, and ambiguous server responses.
- [ ] Implement the minimal streaming client and run all client tests.
- [ ] Commit as `feat(client): stream signed temporary artifacts`.

### Task 2: Add durable upload reservations

**Files:**
- Create: `apps/worker/migrations/0007_artifact_uploads.sql`
- Create: `apps/worker/src/artifacts/d1-uploads.ts`
- Create: `apps/worker/src/artifacts/d1-uploads.test.ts`
- Modify: `apps/worker/src/persistence/schema.test.ts`

- [ ] Test atomic reservation, identical retry, conflicting locator reuse, stale-upload recovery, successful availability, and publication claim.
- [ ] Add `artifact_uploads` with tenant-scoped locator identity, checksum, size, media type, state, expiry, and timestamps.
- [ ] Add a database trigger that rejects active unclaimed uploads before the configured R2 reject limit.
- [ ] Ensure incomplete and unclaimed uploads are visible to bounded cleanup.
- [ ] Commit as `feat(worker): reserve temporary artifact uploads`.

### Task 3: Authenticate and store streaming uploads

**Files:**
- Modify: `apps/worker/src/intake/authenticate.ts`
- Create: `apps/worker/src/artifacts/routes.ts`
- Create: `apps/worker/src/artifacts/routes.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/index.test.ts`

- [ ] Test unknown client, wrong tenant, stale timestamp, bad signature, invalid locator, unsupported media type, invalid size, capacity rejection, checksum mismatch, idempotent retry, locator conflict, and verified success.
- [ ] Authenticate the signed declared hash without buffering the request body; rely on R2 `sha256` validation for the streamed bytes.
- [ ] Restrict locators to `temporary/<tenant>/.../<sha256>.<extension>` and media types to an explicit allowlist.
- [ ] Verify the returned R2 object and its `head` metadata before marking the upload available.
- [ ] Route `PUT /v1/artifacts` without waking delivery work.
- [ ] Commit as `feat(worker): accept verified temporary artifacts`.

### Task 4: Gate publication intake on uploaded bytes

**Files:**
- Modify: `apps/worker/src/intake/routes.ts`
- Modify: `apps/worker/src/intake/routes.test.ts`
- Modify: `apps/worker/src/intake/d1-intake-store.ts`
- Modify: `apps/worker/src/intake/d1-intake-store.test.ts`

- [ ] Test rejection when a temporary object is absent or differs in checksum, size, media type, or tenant.
- [ ] Test successful intake atomically marks matching upload rows claimed and stores temporary artifacts as available.
- [ ] Keep external and live artifact behavior unchanged.
- [ ] Commit as `feat(intake): require verified temporary artifacts`.

### Task 5: Recover and clean abandoned uploads

**Files:**
- Modify: `apps/worker/src/cleanup/d1-cleanup.ts`
- Modify: `apps/worker/src/cleanup/d1-cleanup.test.ts`
- Modify: `docs/runbooks/producer_adoption.md`

- [ ] Test deletion of expired uploading objects and available uploads never claimed by a publication.
- [ ] Test that claimed, ambiguous, and actively referenced artifacts remain protected.
- [ ] Document upload, verification, submission, local retention, and retry ordering.
- [ ] Run the complete local validation suite and secret scan.
- [ ] Commit as `feat(cleanup): collect abandoned temporary uploads`.

## Safety gates

- No deploy, remote migration, GitHub Action, provider request, OneSignal request, or production change.
- Upload remains unavailable in staging and production until this complete plan passes locally and a separate manual deployment is authorized by the existing rollout gate.
- Maximum object size is 50 MB; capacity and accounting uncertainty fail closed.
- No paid fallback or automatic plan upgrade exists.
