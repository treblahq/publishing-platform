# Cloudflare Production Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the final Cloudflare production Worker against the already-populated D1 and R2 resources, validate it on Cloudflare-owned URLs, and leave Hostinger and public DNS unchanged.

**Architecture:** Hydrate the production configuration with the same D1 identifier used by the promoted staging dataset and bind the existing R2 bucket, while retaining dedicated production queues. A fail-closed readiness layer proves that only `web.r2` is enabled, OneSignal/social configuration is absent, Pages origins are the approved Cloudflare candidate, and staging cannot consume production work. Deployment remains manual and read-dominant.

**Tech Stack:** TypeScript, Node.js 24, Vitest, Cloudflare Workers, D1, R2, Queues, Pages, Wrangler, GitHub Actions.

---

### Task 1: Declare production-candidate resource ownership

**Files:**
- Modify: `apps/worker/src/wrangler-config.test.ts`
- Modify: `apps/worker/wrangler.json`

- [ ] **Step 1: Write the failing configuration test**

Assert that production uses `publishing-platform-production`, dedicated `publishing-delivery-production` queues, the promoted `publishing-artifacts-staging` bucket, `web.r2`, and the approved Openings Pages/canonical URLs. Assert that staging has no cron triggers or queue consumers after retirement.

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx vitest run apps/worker/src/wrangler-config.test.ts` and expect a failure because production currently disables all adapters and references a separate R2 bucket.

- [ ] **Step 3: Implement the minimum production-candidate configuration**

Set the production R2 binding to the promoted bucket, enable only `web.r2`, copy the verified Openings web adapter configuration, and remove staging consumers and cron triggers. Keep production queues distinct and leave every D1 UUID as a public placeholder.

- [ ] **Step 4: Run the focused test and verify success**

Run `npx vitest run apps/worker/src/wrangler-config.test.ts`; expect all tests to pass.

- [ ] **Step 5: Commit**

Commit as `feat(platform): declare production candidate resources [skip ci]`.

### Task 2: Add fail-closed production hydration

**Files:**
- Create: `tooling/hydrate-production-config.mjs`
- Create: `tooling/hydrate-production-config.test.mjs`

- [ ] **Step 1: Write failing hydration tests**

Cover a valid `CLOUDFLARE_D1_DATABASE_ID`, immutable source config, absolute Worker entry point and migrations path, replacement of only the production placeholder, and rejection of missing or malformed UUIDs.

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx vitest run tooling/hydrate-production-config.test.mjs`; expect module-not-found failure.

- [ ] **Step 3: Implement production hydration**

Export `hydrateProductionConfig(config, environment, configDirectory)`. Deep-clone the public config, validate the UUID with the existing strict UUID expression, resolve `main` and `migrations_dir`, replace only `env.production.d1_databases[0].database_id`, and write a destination file with exclusive creation when invoked as a CLI.

- [ ] **Step 4: Run the focused test and verify success**

Run `npx vitest run tooling/hydrate-production-config.test.mjs`; expect all tests to pass.

- [ ] **Step 5: Commit**

Commit as `feat(tooling): hydrate production candidate config [skip ci]`.

### Task 3: Enforce production-candidate readiness

**Files:**
- Create: `tooling/production-readiness.mjs`
- Create: `tooling/production-readiness.test.mjs`

- [ ] **Step 1: Write failing readiness tests**

Create a safe fixture and assert acceptance only when the production Worker name and queues are final, D1 is hydrated, R2 is the promoted existing bucket, only `web.r2` is enabled, preview/canonical URLs match, OneSignal is absent, and staging has neither queue consumers nor cron triggers. Add one mutation test for every guard.

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx vitest run tooling/production-readiness.test.mjs`; expect module-not-found failure.

- [ ] **Step 3: Implement the readiness validator**

Export `assertProductionReady(config)`, parse adapter configuration defensively, reject placeholder IDs, extra adapters, social/push configuration, wrong origins, wrong resource bindings, shared queue names, and active staging writers. The CLI prints `Production candidate configuration is safe to deploy.` only after every assertion succeeds.

- [ ] **Step 4: Run the focused test and verify success**

Run `npx vitest run tooling/production-readiness.test.mjs`; expect all tests to pass.

- [ ] **Step 5: Commit**

Commit as `feat(tooling): guard production candidate deployment [skip ci]`.

### Task 4: Add read-dominant live verification

**Files:**
- Create: `tooling/verify-production-candidate.mjs`
- Create: `tooling/verify-production-candidate.test.mjs`

- [ ] **Step 1: Write failing verifier tests**

Test successful health, capacity, and known web-route responses; reject unhealthy responses, exhausted free capacity, missing exact canonical/title/revision metadata, unexpected writes, and request timeouts. Use injected `fetch` so tests make no network calls.

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx vitest run tooling/verify-production-candidate.test.mjs`; expect module-not-found failure.

- [ ] **Step 3: Implement the verifier**

Export `verifyProductionCandidate(options)`. Bound each request with `AbortSignal.timeout(10000)`, allow only GET/HEAD requests, inspect `/health/live`, `/admin/capacity`, and one caller-supplied known entity URL, and return a sanitized result without credentials.

- [ ] **Step 4: Run the focused test and verify success**

Run `npx vitest run tooling/verify-production-candidate.test.mjs`; expect all tests to pass.

- [ ] **Step 5: Commit**

Commit as `feat(tooling): verify production candidate safely [skip ci]`.

### Task 5: Add the manual deployment gate

**Files:**
- Create: `.github/workflows/deploy-production-candidate.yml`
- Create: `tooling/production-workflow.test.mjs`

- [ ] **Step 1: Write the failing workflow contract test**

Assert `workflow_dispatch`, protected `production` environment, concurrency without cancellation, pinned actions, credential preflight, `npm ci`, full validation, production hydration/readiness, Wrangler dry-run before deployment, production-only deploy, health verification, and absence of backfill, OneSignal, social adapters, DNS, Pages deployment, or write-based smoke commands.

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx vitest run tooling/production-workflow.test.mjs`; expect failure because the workflow does not exist.

- [ ] **Step 3: Implement the workflow**

Create a manual job using the protected `production` environment. Reuse the existing credential names, hydrate `/tmp/publishing-platform-production.json`, execute readiness and dry-run checks, install only Worker secrets, apply already-idempotent migrations, deploy with `--env production`, and perform GET-only health verification. Do not bootstrap, backfill, publish, mutate DNS, or call OneSignal.

- [ ] **Step 4: Run the focused test and verify success**

Run `npx vitest run tooling/production-workflow.test.mjs`; expect all tests to pass.

- [ ] **Step 5: Commit**

Commit as `feat(ci): add production candidate deployment [skip ci]`.

### Task 6: Document promotion, cutover boundary, and rollback

**Files:**
- Create: `docs/runbooks/production_candidate.md`
- Modify: `docs/runbooks/staging.md`

- [ ] **Step 1: Write the operational runbook**

Record promoted resource ownership, protected environment secrets, exact preflight/deploy/parity order, free-plan stop conditions, staging retirement, proof that social/push are disabled, DNS cutover prerequisites, Hostinger rollback, and the rule that Hostinger retirement is a later decision.

- [ ] **Step 2: Cross-check the runbook against executable guards**

Search every named resource and command in configuration, tooling, and workflow files. Correct any mismatch before committing.

- [ ] **Step 3: Commit**

Commit as `docs(platform): add production candidate runbook [skip ci]`.

### Task 7: Verify locally and prepare the protected environment

**Files:**
- Verify only; do not add secrets to repository files.

- [ ] **Step 1: Run repository validation**

Run `npm run validate` with Node.js 24. Expect secret scan, Worker types, build, lint, typecheck, and every test to pass.

- [ ] **Step 2: Verify repository state and workflow inactivity**

Run `git diff --check`, confirm the worktree is clean, push `[skip ci]` commits, and confirm no workflow was triggered.

- [ ] **Step 3: Prepare the protected GitHub production environment**

Create or verify the `production` environment secrets using the existing Cloudflare account/token, promoted D1 UUID, and a production admin token. Do not install a producer signing secret while the candidate is read-only. Never print secret values. This creates configuration only and does not deploy.

- [ ] **Step 4: Stop at the Cloudflare deployment boundary when quota is unsafe**

If the free daily allowance has not reset or preflight cannot prove a successful first deployment, leave the manual workflow undispatched. Otherwise dispatch it once, wait for completion, run read-dominant verification, and continue parity in bounded batches. Never retry blindly.
