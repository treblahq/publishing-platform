# Intake Maintenance Isolation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. No live deployment or Cloudflare operation.

**Goal:** Stop repeating all scheduled maintenance for every accepted HTTP publication.

**Architecture:** Preserve immediate durable outbox dispatch after acceptance. Keep capacity refresh, provider reconciliation, retries and cleanup on the existing scheduled path. Intake already performs its own capacity check; separating later housekeeping does not bypass admission. Keep the current cron schedule and batch bounds unchanged.

**Tech Stack:** TypeScript, Vitest, existing Worker dependency injection.

## Execution evidence

The default HTTP runtime test failed before the change on the tenant-maintenance
query. After separation, all 654 tests passed with build/lint/typecheck/secret
scan. Two additional explicit background binding/query rejection regressions
brought the focused router suite to 14 passing tests, with lint/typecheck
rechecked. The scheduled-path regression verifies all eight empty-work SQL
operations in their original order. Independent review approved the change.

## Task 1: Reproduce the HTTP work amplification

Files: `apps/worker/src/index.ts`, `apps/worker/src/index.test.ts`.

- [ ] Add an accepted-request test with the real runtime outbox and a database spy permitting only the existing outbox claim query. Assert the waitUntil promise resolves with an empty outbox and that no maintenance query or provider call occurs. Current code must fail on `SELECT id FROM tenants`.
- [ ] Add an `outboxHandler` override independently of `scheduledHandler`. Assert accepted requests call only outboxHandler, rejected requests and artifact uploads call neither, and scheduled events still call only scheduledHandler.
- [ ] Run `npm run test:prepared -- apps/worker/src/index.test.ts` and record the expected failures.

## Task 2: Separate existing code paths

- [ ] Make `dispatchRuntimeOutbox` parse bindings and call only `dispatchOutbox(createD1OutboxStore(...), ..., 50)`.
- [ ] Move the five existing maintenance awaits, in their current order, into `runRuntimeMaintenance`, followed by `dispatchRuntimeOutbox(environment)`. Schedule this function only from the existing scheduled entrypoint. Do not change cron configuration or delete any maintenance operation.
- [ ] HTTP 202 uses `(overrides.outboxHandler ?? dispatchRuntimeOutbox)(environment)`; scheduled events use `(overrides.scheduledHandler ?? runRuntimeMaintenance)(environment)`.
- [ ] Add a default-runtime scheduled test that proves maintenance remains reachable. Verify binding/query failures remain visible rather than swallowing the promise rejection.
- [ ] Run focused and full tests, lint, typecheck, build and secret scan. Obtain independent review before a microcommit. Document reduced repeated maintenance, not measured CPU savings or resolution of the historical CPU incident.
