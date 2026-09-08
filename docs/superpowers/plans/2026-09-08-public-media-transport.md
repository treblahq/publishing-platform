# Public media transport implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans and test-driven-development. Platform main is explicitly authorized; do not push or deploy this work.

**Goal:** Implement the independently testable HTTP transport boundary from the approved media gateway design without enabling public access.

**Architecture:** Resolve an opaque tenant/artifact/hash tuple through an injected authorized resolver. Require an account-wide budget admission before any storage operation. Stream only an exact verified object, without hashing video bytes in the Worker. No dependency implementation or runtime route is implicitly enabled.

**Tech Stack:** TypeScript, Fetch streams, Vitest; existing Worker package.

## Task 1: Transport contract and security tests

Create `apps/worker/src/artifacts/public-media.test.ts` and `public-media.ts`.

- [x] Write failing tests for GET/HEAD of an approved PNG: exact bytes, hash ETag, no-store, nosniff, and no body read for HEAD.
- [x] Run `npm run test:prepared -- apps/worker/src/artifacts/public-media.test.ts`; confirm missing-handler failure, then assertion failures against a deny-only stub.
- [x] Implement `handlePublicMediaRequest(request, dependencies)` for `/media/:tenant/:artifactId/:sha256`. `resolve` must return matching tenant/id/hash, approved MIME/size, temporary tenant-scoped locator and a future expiry; denied objects return 404, never a shell. Explicit `enabled: false` denies before resolver/bucket calls.
- [x] Require `admit()` before resolving or reading storage; false or thrown admission returns 503 with no-store. No default admission exists.
- [x] Verify both stored metadata and the native SHA-256 checksum on the same returned object; cancel rejected bodies without reading them. Do not compute a full-file checksum on the CPU-limited runtime.
- [x] Test missing/expired/mismatched objects, unsafe keys, non-allowed MIME, budget denial and dependency failure with zero exposed bytes.

## Task 2: Bounded video ranges

- [x] Add failing tests for closed/open/suffix single ranges, unsatisfiable/multiple/malformed ranges and images with a range.
- [x] Implement a 5,000,000-byte maximum per explicit video range; reject oversized closed/suffix ranges and cap open-ended ranges. A no-range GET remains permitted up to the existing upload limit of 50,000,000 bytes.
- [x] Range GET verifies metadata with HEAD, then verifies the GET object metadata and exact returned offset/length again. It must not trust the earlier HEAD against replacement races.
- [x] HEAD ignores Range per HTTP semantics and never fetches a body. Return 206/Content-Range only for validated range GET; 416 returns `bytes */size` only after authorization.
- [x] Run the targeted tests, then platform validation. Review the diff and commit locally only (`ae8c17b`, 49 transport tests; independent review found no blockers).

## Activation dependencies (not completed by this transport slice)

Production remains unchanged. Durable D1 public grants and retention/cleanup race tests, account-level admission implementation, immutable Openings bridge revision binding, native-provider receipt ownership and Free CPU acceptance are required before wiring this handler into `index.ts`. Passing isolated transport tests is not gateway or migration completion.
