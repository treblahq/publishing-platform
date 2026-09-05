# Local Producer Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every product prepare a valid, durable publication locally, including temporary-media metadata, without making network requests or consuming cloud quota.

**Architecture:** Extend the public Node client with a producer preparation layer. It hashes local files into immutable artifact references, validates a complete envelope, writes that envelope to the existing atomic file outbox, and drains the outbox only when the caller explicitly provides a publishing client.

**Tech Stack:** TypeScript, Node.js file and crypto APIs, Vitest, existing `@treblahq/publishing-contracts` and `@treblahq/publishing-client` packages.

---

### Task 1: Build immutable artifact metadata locally

**Files:**
- Create: `packages/client/src/artifacts.ts`
- Create: `packages/client/src/artifacts.test.ts`
- Modify: `packages/client/src/index.ts`

- [ ] Write a failing test that prepares an `r2-temporary` artifact from a local file and asserts its SHA-256, byte size, media type, stable ID, and caller-provided future locator.
- [ ] Write failing tests that reject empty files, unsupported media types, and files that exceed a caller-supplied byte limit.
- [ ] Run the focused test and confirm it fails because the preparation API is missing.
- [ ] Implement the smallest streaming file inspector that satisfies the tests and returns a validated `ArtifactReference` without network access.
- [ ] Run the focused test and the client tests; expect all to pass.
- [ ] Commit as `feat(client): prepare artifact metadata locally`.

### Task 2: Prepare a publication durably before submission

**Files:**
- Create: `packages/client/src/producer.ts`
- Create: `packages/client/src/producer.test.ts`
- Modify: `packages/client/src/index.ts`

- [ ] Write a failing test that validates and stores an envelope in the atomic file outbox without invoking `fetch`.
- [ ] Write a failing test that drains accepted entries and retains retry-later or failed entries.
- [ ] Run the focused test and confirm the preparation API is missing.
- [ ] Implement `prepare` and bounded `drain` operations by composing the existing contract validator, file outbox, and publishing client interfaces.
- [ ] Run the focused tests and the complete local validation suite.
- [ ] Commit as `feat(client): add durable local producer flow`.

### Task 3: Document safe adoption by product publishers

**Files:**
- Modify: `README.md`
- Create: `docs/runbooks/producer-adoption.md`

- [ ] Document the zero-network preparation sequence, environment-only credentials, temporary-media lifecycle, dry-run expectations, and adoption order for Openings, Troco, Trebla, Turma do Kako, and Equity.
- [ ] Explicitly state that preparation does not upload media, submit publications, run Actions, or transfer delivery ownership.
- [ ] Run secret scanning, formatting checks, type checks, tests, and build locally.
- [ ] Commit as `docs(client): document zero-cost producer adoption`.

## Safety gates

- No GitHub Action, Cloudflare API, R2 upload, platform submission, OneSignal call, provider call, DNS change, or Hostinger change is part of this plan.
- No product publisher is modified while its branch is behind the remote or its working tree contains unrelated changes.
- No credential, endpoint secret, signed URL, generated media, or product state is committed.
