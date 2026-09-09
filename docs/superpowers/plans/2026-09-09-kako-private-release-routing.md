# Kako Private Release Routing Implementation Plan

> Execute within the existing isolated Kako branch using test-driven development. The user's autonomous continuation covers this bounded preparation, not activation or a public cutover.

**Goal:** Preserve private release recovery when the original repository is renamed, without borrowing the public executor's credential.

**Architecture:** Resolve repository ID `1349928184` through the existing bounded GitHub JSON transport. Require the same numeric ID, private visibility and exactly `turmadokako/social-publisher` or `turmadokako/social-publisher-private`. Build subsequent release and asset API URLs only from that validated name. Revalidate on replay. The bootstrap preparation step receives only `PUBLISHING_SOURCE_TOKEN`, intended as a fine-grained Contents-read credential for that original repository. No fallback to `GITHUB_TOKEN` or the state-write credential.

Hardcoding the future name would break the current name; following metadata redirects would obscure identity changes. The immutable-ID approach preserves both names without accepting arbitrary repositories. Keep all draft/tag/inventory/hash, size/deadline, redirect-token-stripping, candidate/source/state, and publication locks intact. Missing credentials stop preparation; public verification does not read source credentials.

**Tech stack:** Existing Node 24.14.1, TypeScript, Zod, Node tests and YAML workflows. No new runtime dependency.

## Steps

- [x] Extend `test/daily-pairs/bootstrap-release.test.ts`: fixture resolves `/repositories/1349928184`, permits both exact private names, verifies renamed download and replay, and rejects public/foreign/string-ID metadata before release reads. Retain bounded transport and stripped asset-redirect credentials.
- [x] Extend `test/daily-pairs/bootstrap-cli.test.ts` and `test/workflows/daily-pair-bootstrap.test.ts`: dedicated source credential only, throwing broad-token getter, missing/blank credential rejection before download, and no source secret in the public verification step. Run focused regressions and observe failure before implementation.
- [x] In `src/daily-pairs/bootstrap-release.ts`, replace the fixed repository API constant with `https://api.github.com/repositories/1349928184`. Have `verifyRelease` return the API base formed from validated `full_name`; use it for downloads. Return the same output shape and keep all file/replay protections.
- [x] In `scripts/bootstrap-pair-media.ts`, validate `PUBLISHING_SOURCE_TOKEN` only for preparation, with 1–1024 non-whitespace characters. Remove only that key from process.env before downstream work; never read or delete the executor token. Change only the bootstrap preparation workflow environment to the new secret.
- [x] Run the focused release/CLI/workflow suites. Independently regenerate the committed compiler build ID with the existing collector because the runtime source bytes changed. Do not weaken or bypass the comparison.
- [x] Run all tests, typecheck, lint and diff checks. Review the security boundary and commit/push only the integration branch. No GitHub/Cloudflare write, download, release upload, secret provisioning, visibility change or workflow run is part of this slice.

Remaining separate gates: credential provisioning and backup, private editorial input hydration, public source/history/log audit, actual identity/permissions verification, quotas and activation. A passing mocked transport test is not evidence of live GitHub token validity or provider delivery.
