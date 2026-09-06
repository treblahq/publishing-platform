# Unified npm Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two public producer packages with one exact dependency named `@trebla/publishing`.

**Architecture:** Consolidate contract and client sources into one public workspace. Keep runtime services and provider adapters as private monorepo workspaces that depend on the same unified API.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Node.js 20/24.

---

### Task 1: Lock the public package boundary

**Files:**
- Modify: `tooling/package-release.test.mjs`
- Test: `tooling/package-release.test.mjs`

- [x] Assert that `@trebla/publishing` is the only non-private publishable workspace.
- [x] Run the release metadata test and confirm it fails before consolidation.
- [x] Mark every app and adapter workspace private.

### Task 2: Consolidate contracts and client

**Files:**
- Create: `packages/publishing/package.json`
- Move: `packages/contracts/src/*` to `packages/publishing/src/contracts/`
- Move: `packages/client/src/*` to `packages/publishing/src/client/`
- Modify: `packages/publishing/src/index.ts`
- Test: `packages/publishing/src/**/*.test.ts`

- [x] Move existing tests with their implementations.
- [x] Export the complete contract and client API from one root entry point.
- [x] Replace internal cross-package imports with relative imports.
- [x] Build and test the new package.

### Task 3: Migrate internal consumers and documentation

**Files:**
- Modify: `apps/worker/**`, `apps/cli/**`, `packages/adapter-*/**`
- Modify: `README.md`, `docs/runbooks/package_release.md`, `docs/runbooks/producer_adoption.md`

- [x] Replace both former package imports with `@trebla/publishing`.
- [x] Regenerate the npm lockfile.
- [x] Run the complete monorepo validation and inspect the packed tarball.
- [x] Commit and publish `@trebla/publishing@0.1.0` publicly.

### Task 4: Migrate product repositories

**Files:**
- Modify: each product `package.json`, lockfile, and platform-envelope test.

- [x] Replace `@trebla/publishing-client` with exact `@trebla/publishing@0.1.0`.
- [x] Verify Openings, Turma do Kako, Equity, Trebla, and Troco locally.
- [x] Commit to the agreed branches with `[skip ci]`, push, and confirm no workflow was triggered.

### Task 5: Retire the former public entry points

- [x] Mark `@trebla/publishing-contracts@0.1.1` and `@trebla/publishing-client@0.1.1` deprecated with a migration message.
- [x] Verify the unified package from the anonymous public registry.
- [x] Confirm every local repository is clean and synchronized.
