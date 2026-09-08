# Durable Media Grant Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task by task with test-driven development and independent reviews. Platform main is authorized. Do not deploy migrations or enable routes.

**Goal:** Resolve existing explicit media approvals from durable storage without making any file publicly accessible yet.

**Architecture:** A new approval table binds one tenant, artifact hash and provider delivery to a finite approval window. A single read joins that approval to the current artifact, retention reference, tenant and explicitly enabled adapter. The resolver cannot create approvals, extend retention or write anything; approval issuance, bridge ownership and account admission remain separate activation dependencies.

**Tech Stack:** TypeScript, D1-compatible SQLite, Node SQLite migration tests, Vitest.

## Task 1: Durable approval records and read-only resolver

Files:

- Create `apps/worker/migrations/0009_public_media_grants.sql`.
- Create `apps/worker/src/artifacts/d1-public-media-grants.ts`.
- Create `apps/worker/src/artifacts/d1-public-media-grants.test.ts`.

- [ ] Write a real-SQLite fixture loading every actual migration, with an enabled Openings tenant, publication, `social.buffer` delivery in `processing`, available PNG artifact, unsafe-to-delete reference, explicit enabled adapter control, and unexpired approval. Write the accepting assertion first:

```ts
const identity = { tenant: 'openings', artifactId: 'artifact_12345678', sha256: 'a'.repeat(64) };
const resolve = createD1PublicMediaResolver(database, ['social.buffer'], () => new Date('2026-09-08T12:00:00.000Z'));
expect(await resolve(identity)).toEqual({
  ...identity, locator: 'temporary/openings/card.png', byteSize: 10,
  mediaType: 'image/png', expiresAt: '2026-09-08T13:00:00.000Z',
});
```

- [ ] Run `npm run test:prepared -- apps/worker/src/artifacts/d1-public-media-grants.test.ts`; confirm the missing-module failure, then assertion failures against a deny-only stub after adding the schema.
- [ ] Add the schema below. No public API or grant-writing service is part of this slice.

```sql
CREATE TABLE public_media_grants (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (tenant_id, artifact_id, delivery_id, sha256),
  CHECK (julianday(approved_at) IS NOT NULL AND julianday(expires_at) IS NOT NULL
    AND julianday(expires_at) > julianday(approved_at))
);
```

- [ ] Implement `createD1PublicMediaResolver(database, allowedAdapters, now)` returning `(identity: PublicMediaIdentity) => Promise<PublicMediaGrant | null>`. Copy the trusted adapter list at construction. Empty adapters, malformed identity, Equity, invalid clock and the `social.shadow` adapter deny. Query one matching grant using bound identity/time parameters, then return only typed fields satisfying the transport's PNG/JPEG/MP4, positive safe size up to 50 MB and safe tenant-scoped temporary locator contract.
- [ ] Use inner joins with matching tenant on **every** participating record, exact artifact SHA-256, `storage = 'r2-temporary'`, artifact `state = 'available'`, null tombstone/deleted markers, enabled tenant and explicit `adapter_controls.enabled = 1`. Missing controls must deny even though general delivery execution currently defaults missing controls to enabled. Require `artifact_references.safe_to_delete = 0`, grant `revoked_at IS NULL`, approval at/before now and expiry strictly after now. Allow only provider delivery states `ready`, `delivering`, `delivered`, `processing`, `retry_wait`, `reconciling`; require membership in the copied adapter list using SQL bind placeholders, never interpolate caller strings. Do not call storage or provider APIs.
- [ ] Extend tests with table-driven changes for missing/revoked/expired/future approvals; wrong tenant/hash; missing/released/cross-tenant reference; missing/disabled/cross-tenant adapter control; disabled tenant; staged/tombstoned/deleted/wrong-storage artifact; terminal/unrecognized delivery state; excluded adapter, shadow and Equity; unsupported MIME, unsafe locator and invalid returned row. Test multiple grants so an invalid first grant does not conceal another valid eligible grant.
- [ ] Confirm reads leave `sqlite.total_changes()` unchanged; deny-only construction must make no database call. Test one SQL read per lookup and no R2 calls (resolver has no bucket dependency).
- [ ] Run the targeted suite, lint, typecheck, build and full platform suite. Review specification and quality independently. Commit the verified local slice; keep `index.ts`, deployment configuration, production database and public access unchanged.

## Remaining activation gates

This resolver is not an issuer and does not prove native-provider ownership or
resolve deletion after an in-flight read. The bridge approval writer must use
the immutable current entity revision and shared tombstone/retention protocol.
Account-wide admission and representative Free CPU evidence are required before
the transport can be enabled. No current publisher guard is removed here.
