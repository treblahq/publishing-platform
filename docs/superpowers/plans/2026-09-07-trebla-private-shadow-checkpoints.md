# Trebla Private Shadow Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Resume pending shadow requests after losing a runner without publishing private state to public GitHub media.

**Architecture:** Reuse the private publication-ledger GitHub contents store with revision-checked writes. Persist a bounded pending request index before any intake; persist immutable per-request acceptance before removing pending entries. Probe intake before reading restored media; provider credentials remain behind the shadow boundary.

**Tech Stack:** TypeScript, Zod, Vitest, GitHubContentsStore, @trebla/publishing 0.1.2.

## Task 1: Durable checkpoint store and replay

Files: new `src/modules/publication/platform-checkpoints.ts` and tests; `platform-bridge.ts` and its tests; `src/cli/publish-editorial.ts` and boundary tests.

- [ ] Add failing tests using an in-memory revision-checked store: pending write failure prevents intake, receipt write failure leaves pending recoverable, fresh outbox plus deleted files repeats exact intake identity, capacity performs zero PUTs, corrupted/conflicting records fail closed, pending requests replay with an empty new batch.
- [ ] Implement a strict versioned index at `platform-shadow/pending.json`, maximum 32 entries and 262144 encoded bytes. Entries contain only schema-valid approved PublicationRequest data and the SHA256 of their deterministic envelope. Persist the complete merged index with a single expected-revision write before submission. Never overwrite a same-key differing envelope.
- [ ] Store accepted records by hashed idempotency key under `platform-shadow/accepted/`. Bind publication ID to the exact approved request/envelope hash. Write acceptance before index compaction. Interrupted or conflicting writes abort with fixed codes; the next invocation restores and reconciles, never silently overwrites.
- [ ] Replay at most three pending entries per invocation, oldest first. Accept up to three new requests; merge and validate all fresh requests before first transport. Empty new requests still replay pending work. Return retry-later while pending remains, preventing native provider continuation on an incomplete shadow batch.
- [ ] Extract approved-media verification for reuse. New uncheckpointed requests verify all files first. Restored checkpoints and valid accepted records do not require files. Only SDK intake 409 ARTIFACT_NOT_READY permits checking all bytes before upload. Missing or altered needed bytes retain the checkpoint. No credentials, absolute paths, binary media, or public-media writes belong in stored records.

## Task 2: Real CLI integration and compatibility

- [ ] In production mode, after qualification and only when shadow is explicitly enabled, construct the existing private publication-ledger store using GITHUB_TOKEN and pass it to the bridge. Require durable storage on the production entrypoint. Do not read SOCIAL_TOKEN_VAULT_KEY or provider/media credentials before shadow acceptance. Reuse the store for native ledger afterward. Disabled and dry-run paths retain existing behavior and avoid new storage access.
- [ ] Preserve compatibility for direct bridge tests without store, without representing that mode as restart-durable. Do not add runtime variables, repositories, secrets, schema migrations, or live network calls.
- [ ] Verify targeted tests, then full tests, types/build, lint, and existing safety checks from package scripts. Review before `[skip ci]` microcommit. Do not push or enable the gate until root review.
