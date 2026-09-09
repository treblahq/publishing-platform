# Public Snapshot Inventory Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. This tool must never copy files, publish a repository or alter visibility.

**Goal:** Verify an explicitly reviewed, hash-pinned source inventory before any future clean public executor export.

**Architecture:** Inspect selected blobs from an exact local Git commit, never a directory glob or the dirty working tree. An exact path/SHA256 manifest is required; private content, assets, state, fixtures and existing workflows are denied even when listed. Return metadata only. Passing this mechanical check is not approval of editorial content, executable dependencies or public execution.

**Tech Stack:** Node built-ins, existing secret-pattern scanner, Vitest with disposable Git fixtures.

## Task 1: Exact snapshot contracts

Execution status: both tasks completed locally on September 8 (September 9 UTC).
The checklist below preserves the original test-first specification. Final
verification passed 706 tests across 93 files, lint, typecheck and the known
credential-pattern scan. The inventory suite contains 31 tests. Independent
review prompted regressions and fixes for inherited Git environment redirection,
partial-clone lazy fetching, and bounded regular-file manifest reads. Re-review
approved this inventory-only scope. No real source export or visibility change
was performed.

Create `tooling/audit-public-snapshot.mjs` and `.test.mjs`.

- [ ] Export `auditPublicSnapshot({repositoryRoot, manifest})`. Manifest is exactly `{schemaVersion: 1, sourceCommit: <40 lowercase hex>, files: [{path, sha256}]}`; reject extra fields, empty/duplicate entries and more than 500 entries before reading blobs.
- [ ] Permit only reviewed source `.ts/.tsx/.js/.jsx/.mjs/.cjs/.json` beneath `src/` or `scripts/`, and exact root `package.json`, `package-lock.json`, `tsconfig.json`, `README.md`, `LICENSE`. Reject test/spec/fixture paths, top-level private data/config/docs/workflows/generated directories, environment/credential/key filenames, absolute paths, traversal, backslashes, control characters and glob syntax.
- [ ] Use read-only Git commands with argument arrays, fixed timeouts/output limits and no replace-object resolution. Verify the exact commit, tree entry and regular blob mode (100644/100755). Reject symlink/submodule/directory entries. No checkout, Git mutation, network, hook, copy or file write.
- [ ] Inspect size before content: at most 2 MiB per file and 16 MiB total. Compare exact SHA256 and reject binary/invalid UTF-8 or existing known secret-pattern matches. Errors are fixed codes, never raw Git output or file contents.
- [ ] Return `{sourceCommit, files:[{path,sha256,byteSize}], totalBytes, scope:'inventory-only'}`. Importing must have no side effects. A CLI may read an explicitly supplied JSON manifest and print this report; it must not generate its own approval manifest.

## Task 2: TDD and verification

- [ ] Before implementation, write disposable Git fixture tests for a valid selected source, unlisted private files never read or copied, dirty worktree independence, changed hash, missing commit/path, traversal/glob/duplicate, forbidden paths, symlink blob, oversized/binary source and known credential patterns. Confirm missing-function/module failures.
- [ ] Implement and rerun focused tests. Prove no working-tree or repository mutation and no raw secret in errors.
- [ ] Run full platform tests, lint, typecheck and secret scan; request independent review before committing exact files. Do not attach this tool to a production workflow or count private/public cutover complete.
