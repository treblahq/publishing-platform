# Finite Media Admission Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD and independent specification/quality review. Do not deploy or wire the route.

**Goal:** Atomically consume a finite, account-shared allocation before public
media transport can resolve or fetch an artifact.

**Architecture:** One existing allocation row per account, no per-tenant or
per-request allocation. A conditional UPDATE reserves the entire cost vector
or nothing. Provisioning and refresh are explicitly not public request duties.

**Tech Stack:** TypeScript, existing D1 structural interfaces, Node SQLite,
Vitest, existing migration runner used by tests.

## Task 1: durable allocation and admission

Create `apps/worker/migrations/0011_public_media_admission.sql`,
`apps/worker/src/capacity/d1-public-media-admission.ts` and
`apps/worker/src/capacity/d1-public-media-admission.test.ts` only.

Follow the complete contract in
`docs/superpowers/specs/2026-09-09-media-admission-allocation-design.md`.

- [x] Start with actual migration loading and a valid seeded allocation fixture.
  The table is `public_media_admission_allocations`; use `account_id` (32 lowercase
  hexadecimal characters) as primary key, `enabled` (0 or 1), `measured_at_ms`,
  `expires_at_ms`, and `d1_reads_limit`, `d1_reads_reserved`,
  `d1_writes_limit`, `d1_writes_reserved`, `r2_class_b_limit`,
  `r2_class_b_reserved`. Integer fields have `typeof(...) = 'integer'` checks,
  range 0 through 9007199254740991; counters cannot exceed ceilings. Time checks
  require expiry after measurement and at most 900000 milliseconds later.
  Do not seed real allocations in the migration.
- [x] Write the initial failing test around this exact API:

```ts
const cost = { d1Reads: 2, d1Writes: 1, r2ClassB: 2 };
const admit = createD1PublicMediaAdmission(database, 'a'.repeat(32), cost,
  () => new Date('2026-09-09T12:00:00.000Z'));
expect(await admit()).toBe(true);
expect(await admit()).toBe(false);
```

  The fixture ceiling equals that cost vector; reserved counters initially zero.
  Run `npx vitest run apps/worker/src/capacity/d1-public-media-admission.test.ts`
  with Node 24. Confirm failure from missing behavior, not an unrelated setup
  error, before writing production code.
- [x] Export `PublicMediaAdmissionCost` with numeric `d1Reads`, `d1Writes`,
  `r2ClassB`, and `createD1PublicMediaAdmission(database, accountId, cost, now)`.
  The returned no-argument function is `() => Promise<boolean>`. Copy and validate
  configuration once; invalid runtime values deny without preparing SQL. Capture
  one valid Date per invocation; exceptions deny. Use the existing structural
  D1 statement pattern: `prepare(sql).bind(...values).run()` returning
  `{ success?: boolean; meta?: { changes?: number } }`.
- [x] Implement exactly one conditional reservation statement, not SELECT then
  UPDATE, using this update shape:

```sql
UPDATE public_media_admission_allocations
SET d1_reads_reserved = d1_reads_reserved + ?,
    d1_writes_reserved = d1_writes_reserved + ?,
    r2_class_b_reserved = r2_class_b_reserved + ?
WHERE account_id = ? AND enabled = 1
  AND measured_at_ms <= ? AND expires_at_ms > ?
  AND CAST(measured_at_ms / 86400000 AS INTEGER) = ?
  AND d1_reads_limit - d1_reads_reserved >= ?
  AND d1_writes_limit - d1_writes_reserved >= ?
  AND r2_class_b_limit - r2_class_b_reserved >= ?
```

  Bind copied costs, account ID, captured current milliseconds twice, current
  UTC day number, then copied costs. Accept only explicit `success === true`
  together with `meta.changes === 1`. Catch
  database failures and return false. No automatic retry, refund or INSERT.
- [x] Add RED/GREEN cases for each exhausted dimension, partial capacity denial
  without changed counters, missing/disabled/future/expired allocation, exact
  expiry, UTC-day rollover despite an otherwise live allocation, invalid account,
  unsafe/fractional/zero/negative or too-small costs, invalid/throwing clock,
  mutated caller cost object, persistent exhaustion in a fresh factory, and
  overlapping calls from different factories sharing the same account ceiling.
  Verify counters, one statement per eligible call and zero SQL for invalid
  configuration. Include malformed/ambiguous write result and response loss after
  a committed reservation: no refund, next request reserves afresh or denies.
  A downstream grant/object failure must also leave the reservation consumed.
- [x] Compose the actual admission callback with `handlePublicMediaRequest` in a
  test. On denial, resolver and bucket must not be called; on admission, use the
  existing valid identity/grant/object fixture pattern to obtain HTTP 200. Reuse
  the same finite allocation for callers representing different tenants.
- [x] Focused tests, targeted lint and diff check must pass before reporting.
  Do not run external requests or use actual production binding/credentials.

## Task 2: root verification and integration

- [x] Review specification compliance independently, then implementation quality.
- [x] Run `npm run validate` under Node 24 and inspect successful completion.
- [x] Update `docs/runbooks/migration_completion.md` with actual evidence and all
  unresolved activation gates: allocation provisioning, bounded denial costs,
  conservative resolver costs, public grant/retention/provider ownership and CPU.
- [ ] Commit only reviewed files with `[skip ci]`. Preserve all remote runtime
  settings. No new npm release is needed for this internal Worker component.

Passing these tests proves local finite admission, not account-wide Free
acceptance, production provisioning or completion of the media gateway.
