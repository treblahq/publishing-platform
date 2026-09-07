# Social Shadow Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compile-time `social.shadow` adapter that exercises the durable delivery lifecycle without calling a social provider.

**Architecture:** A private workspace implements the existing adapter-kit contract. It accepts only provider-neutral `social.post` payloads, derives a deterministic receipt from the delivery identity and payload, and performs no network or provider operation. The Worker compiles the adapter but production keeps it disabled until a product-specific shadow rollout is approved.

**Tech Stack:** TypeScript, npm workspaces, Vitest, existing `@trebla/publishing` and `@trebla/publishing-adapter-kit` contracts.

---

### Task 1: Implement the no-write adapter

**Files:**
- Create: `packages/adapter-shadow/package.json`
- Create: `packages/adapter-shadow/tsconfig.json`
- Create: `packages/adapter-shadow/src/index.ts`
- Create: `packages/adapter-shadow/src/index.test.ts`

- [ ] Write a failing test that imports `createSocialShadowAdapter`, validates a `social.post`, receives the same deterministic receipt twice, and observes zero provider calls because the adapter has no transport dependency.
- [ ] Write failing cases for the wrong payload type, empty text, missing artifact IDs, and unsupported operations.
- [ ] Run `npx vitest run packages/adapter-shadow/src/index.test.ts`; expect failure because the workspace does not exist.
- [ ] Implement a private adapter with manifest name `social.shadow`, channel `social.post`, operation `compare`, synchronous ingestion, reconciliation support, and no credential/config requirement.
- [ ] Return a verified receipt whose `remoteId` is a SHA-256 fingerprint of delivery identity plus the validated payload; reconciliation returns `verified` for that receipt.
- [ ] Run the focused tests; expect all cases to pass.

### Task 2: Compile the adapter into the Worker without enabling it

**Files:**
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/index.test.ts`
- Modify: `apps/worker/wrangler.json`
- Modify: `apps/worker/src/wrangler-config.test.ts`
- Modify: `package-lock.json`

- [ ] Write failing assertions that the runtime registry compiles `social.shadow` while the production `ENABLED_ADAPTERS` value remains exactly `web.r2`.
- [ ] Run the focused Worker tests and confirm the missing adapter wiring fails.
- [ ] Add the workspace dependency, instantiate the adapter in delivery and reconciliation registries, and make no change to production enablement.
- [ ] Refresh the lockfile without changing external versions.
- [ ] Run the focused Worker tests; expect them to pass.

### Task 3: Verify and document the rollout boundary

**Files:**
- Modify: `docs/runbooks/producer_adoption.md`

- [ ] Document that compiling `social.shadow` does not enable it, make provider calls, or grant a producer access.
- [ ] Document the later rollout order: product branch validation, producer credential, tenant adapter enablement, bounded shadow smoke, then observation.
- [ ] Run `npm run validate` with Node.js 24 and inspect the packed public npm tarball to confirm the new private workspace is excluded.
- [ ] Run the repository secret scan and `git diff --check`.
- [ ] Commit in micro-commits with `[skip ci]`; do not deploy or dispatch GitHub Actions.
