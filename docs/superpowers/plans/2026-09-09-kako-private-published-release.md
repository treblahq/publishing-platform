# Kako Private Published Release Implementation Plan

> Use the existing isolated Kako worktree and test-driven development. The user's continuation authorizes local preparation, not changing the remote release or widening credentials.

**Goal:** Add explicit support for a completed release inside the original private repository while preserving the existing draft-only contract.

**Architecture:** Version-one descriptors remain draft-only. A strict version-two descriptor requires `releasePublishedAt`, a UTC timestamp with whole seconds. Its release must have `draft: false` and the exact `published_at`. Both versions retain immutable repository ID, private visibility, allowed names, release ID/tag, complete asset inventory, checksums and bounded transport. The descriptor hash already namespaces the download cache, preventing reuse under a different release state. No runtime fallback, descriptor conversion or release mutation is introduced.

**Alternatives considered:** Granting Contents write would expand credential authority and contradict the approved read-only boundary. Removing the draft check would silently broaden every existing descriptor. An explicit version-two contract makes the changed access state reviewable without changing old behavior. A completed release in a private repository is not a social post or a public repository, but completing the actual release remains a separate access/notification decision requiring approval.

**Tech stack:** Node 24, TypeScript, Zod, existing Node test fixtures.

## Steps

- [x] Add regression tests in `test/daily-pairs/bootstrap-release.test.ts` for explicit version-two private completed release download/replay, strict timestamp schema, draft/timestamp drift, public/foreign repository rejection, asset mismatch and distinct cache identity. Observe the acceptance case fail before implementation.
- [x] In `src/daily-pairs/bootstrap-release.ts`, preserve the current strict object as a version-one base; export a discriminated union with `base.extend({schemaVersion: z.literal(2), releasePublishedAt: z.iso.datetime({precision: 0})}).strict()`. Apply existing common refinement unchanged.
- [x] Choose the release metadata schema by descriptor version: version one requires `draft: true`; version two requires `draft: false` and `published_at: z.literal(descriptor.releasePublishedAt)`. Keep all other checks unchanged.
- [x] Run release regressions and workflow/CLI compatibility checks. Regenerate runtime compiler identity with the existing collector, without weakening comparison.
- [x] Document the opt-in and remote activation hold. Run full `npm run verify`, credential-pattern scan and independent review before an isolated branch commit/push.

## Local verification evidence

The acceptance regression failed before implementation. All 20 release tests
then passed; independent review also passed 23 release/workflow tests and found
no defects. Full `npm run verify` passed 1,449 tests, with zero failures or skips,
in 910.3 seconds, followed by typecheck, lint and diff checks. The known
credential-pattern scan passed. The existing compiler collector independently
matched `f6f4039551646a71541c9746a707cbe56fe0917f5e08b31f0417cdfba79d6b0d`.
Implementation commit: `9c6f5db`, isolated `cloudflare-publishing-cutover` branch.
This completes local implementation only, not remote activation or migration.

## Remote hold

Do not change the existing version-one production descriptor, publish or edit release 383205199, download its media, activate a workflow, expose a private repository, upgrade a plan or deploy. Local fixtures cannot prove that a future completed private release is readable with this token. After separately approved remote preparation, validate the exact token/release metadata and reviewed bytes before adoption.
