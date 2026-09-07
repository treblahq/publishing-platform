# Producer Restart Durability

> Preserve approved transport identity across fresh runners without public private-state dumps or new paid infrastructure.

## Decision and scope

Reuse product-owned state. A new recovery-query API would not preserve unaccepted work and would introduce partial-envelope matching. A new D1 checkpoint table would duplicate existing product state and require another admission, retention, and authorization lifecycle. Neither is required for this stage.

Keep all shadow gates disabled while implementing and testing. Native provider ownership remains unchanged. No OneSignal work, paid service, bulk backfill, or provider test post is included.

## Troco

The current public campaign state contains approved copy and media hashes but not byte sizes. Byte sizes participate in the platform envelope revision, so a fresh runner cannot reproduce that identity after deleting media.

Add an optional strict `platformMedia` record to the existing campaign state. It contains a schema version, SHA-256 binding of the approved plan/source commits/render hashes, and the ordered verified artifact hashes and byte sizes. It contains no envelope, credentials, local paths, remote publication IDs, private URLs, or binary data.

Capture the record during the existing `intent` phase after authorization and before its existing state commit. Initial capture verifies all media before returning any evidence. The workflow's state commit must succeed before the `execute` phase can call intake. When a bound record exists, preparation validates it without reading media. Mutating the approved plan or hashes never silently replaces the original evidence.

The execution path reconstructs the exact envelope and upload references from the checkpoint and current product-owned approved data. Let SDK 0.1.2 probe intake first. Only an explicit `409 ARTIFACT_NOT_READY` permits full local media validation followed by upload. A remote acceptance or capacity rejection must not access deleted bytes. If missing bytes are needed, retain the checkpoint and report a fixed retryable failure without a provider write.

The phase runner must require persisted evidence when the gate is enabled. Pure bridge calls without product state persistence remain a local compatibility path and must validate all initial media before transport.

## Trebla

Use the existing private `publication-ledger` and its revision-checked GitHub contents store. Preserve the approved publication request, which already contains hashes, sizes, MIME types and copy, before the first intake call. Store only relative approved asset references, never credentials or absolute paths.

A bounded pending checkpoint index must be written atomically before submission. The record must permit replay independently of the newly qualified batch. Restore only schema-valid, immutable approved requests; reject conflicts instead of replacing them. Remote acceptance is persisted before pending metadata is compacted. A crash at either persistence boundary must leave enough information to repeat the same intake and recover its ID.

GitHub state access may use the existing repository-scoped token after qualification; provider-vault access remains after the shadow gate. Missing durable state permissions block activation rather than falling back to runner-only state.

## Verification and rollout

Prove response loss followed by fresh-runner recovery, acceptance followed by receipt persistence failure, capacity before acceptance, missing unaccepted media, changed approval rejection, disabled/dry paths without credential or file access, and replay of pending work absent from the new selection. Run complete local product checks before microcommits.

Only after these checks may a bounded shadow rollout be evaluated against current measured free-tier usage. Passing shadow checks is not migration of native provider delivery.
