# Troco Restart Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reconstruct an identical shadow submission on a fresh runner after deleting local media.

**Architecture:** Capture public verified media metadata in the existing campaign intent commit. Reconstruct the immutable envelope before touching files; only ARTIFACT_NOT_READY authorizes verification and upload. Keep the remote gate disabled and native publication unchanged.

**Tech Stack:** Node 20, TypeScript, Zod, node:test, @trebla/publishing 0.1.2.

## Task 1: Bound media checkpoint

Files: `src/state/schema.ts`, new `src/publishing/platform-media.ts`, `tests/platform-bridge.test.ts`.

- [ ] Add regression tests capturing verified sizes and approval binding, then recovering with a fresh outbox after deleting media. Assert the intake body is identical and only one POST occurs.
- [ ] Run `node --import tsx --test tests/platform-bridge.test.ts`; observe the missing checkpoint behavior fail.
- [ ] Add strict optional `platformMedia: {schemaVersion: 1, approvalSha256, assets: [{sha256, byteSize}]}`. SHA is 64 lowercase hex, sizes positive integers at most 50,000,000, assets bounded to six. Hash parsed `{plan, sourceCommits, renderHashes}`; ignore operational transitions. Reject changed approvals and mismatched ordered hashes/counts. Capture all verified bytes before returning a new state.
- [ ] Add tests for changed copy/hash/size, missing needed media, capacity with missing media, malformed persisted metadata, disabled execution, and symlink rejection.
- [ ] Verify targeted tests pass and no private paths or envelope fields appear in the persisted checkpoint.

## Task 2: Acceptance-first bridge

Files: `src/publishing/platform-bridge.ts`, `src/publishing/platform-media.ts`, `tests/platform-bridge.test.ts`.

- [ ] Demonstrate the regression: approved checkpoint plus missing render directory currently fails before intake.
- [ ] Build envelope artifact sizes from checkpoint. Derive upload references using approved kind and filename without accessing the filesystem. Wrap intake fetch: inspect only cloned 409 responses with `code === 'ARTIFACT_NOT_READY'`, validate every local file before allowing SDK upload. Preserve full preflight for compatibility calls without checkpoints. Return fixed safe error codes.
- [ ] Run targeted tests; assert accepted/capacity responses need no bytes and changed files never cause PUT.

## Task 3: Durable intent boundary

Files: `src/cli/publish.ts`, `tests/platform-bridge.test.ts`.

- [ ] Add failing CLI tests: enabled execute without checkpoint is rejected without transport, intent captures checkpoint without any transport, and capacity leaves committed state unchanged.
- [ ] Resolve render root before phase split. With exact true gate, capture checkpoint after authorization and before `persistPublicationIntent`; pass captured state into that existing atomic write. Enabled execute requires persisted checkpoint after its active-intent check. Disabled path does not read media.
- [ ] Run `npm run check` and `npm run validate` with Node 20 and `BRAND_ROOT` pointing to the canonical Troco frontend public directory.
- [ ] Review the scoped diff, commit with `[skip ci]`, and integrate the reviewed branch without workflow dispatch. Keep production shadow variable false until the complete rollout safety checks are satisfied.
