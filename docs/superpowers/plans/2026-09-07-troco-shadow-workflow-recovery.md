# Troco Shadow Workflow Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the tightly coupled recovery path.

**Goal:** Recover cloud acknowledgements before media planning/restoration can fail, without invoking native providers.

**Architecture:** A gated recovery CLI examines persisted campaign checkpoints independently of native next-action selection. It attempts three candidates per run in least-recently-attempted order and persists only a public envelope digest acknowledgement and attempt timestamp in campaign state. Global capacity/transport deferral blocks later network work; per-record missing media or invalid history returns nonblocking pending so restoration is reachable. Workflow commits partial progress before propagating a blocking failure.

**Tech Stack:** TypeScript, node:test, Zod, existing atomic state storage and SDK bridge.

- [ ] Test recovery with deleted render root, active native intent, fresh outbox and server acceptance; assert unchanged native stages and no provider transport.
- [ ] Test global capacity stops immediately; media-specific failure continues to the next candidate; attempt timestamps rotate more than three pending entries; malformed individual records do not prevent other valid records being recovered.
- [ ] Add strict optional `platformShadow` state metadata with ISO `lastAttemptAt` and optional 64-hex `acknowledgedEnvelopeSha256`. Only a digest equal to the reconstructed validated envelope skips intake; mismatched acknowledgement is an error, never silently replaced.
- [ ] Implement `src/publishing/platform-recovery.ts` and `src/cli/recover-platform.ts`. Require exact enabled gate and explicit scheduled/controlled authorization. Read indexed states independently, preserve invalid records unchanged, return safe counters/codes, never expose private payloads. Maximum three network attempts per invocation; only fixed media errors continue, capacity stops; other uncertain transport errors defer.
- [ ] Persist successful acknowledgement before native execution in existing publish CLI. No provider ownership or native retry-selection changes.
- [ ] Add workflow step before media restoration/planning, with gated producer secrets only. Execute recovery, capture status, run existing commit-state regardless of partial failure, then return the captured status. No provider credentials in this step and no workflow trigger changes.
- [ ] Run targeted RED/GREEN, full `npm run check` and `npm run validate`, independent review, and `[skip ci]` microcommit. Keep remote shadow gate false until production rollout checks.

Review correction: a missing-media 409 must not stop the step before the workflow can restore media. The regression exercises pending recovery, successful exit to restoration, restored approved bytes, and acceptance of the exact original envelope. Existing native planning validation is not bypassed for corrupt historical state.

The workflow invokes the bounded cloud-only recovery command again after media planning, before archive preservation. This second pass is required for active native intents that next-action intentionally does not select. Each pass has at most three candidates; the two-pass workflow has at most six candidate attempts and both honor the global platform capacity boundary. Tests assert both actual invocation positions, opt-in secret scope, and commit-before-exit behavior.
