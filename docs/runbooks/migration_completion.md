# Migration Completion Checklist

> Track the approved 25-step migration against fresh evidence, without exposing credentials or equating local tests with production readiness.

## Operating constraints

The approved target is Cloudflare Pages for sites, standard public GitHub Actions runners for heavy publisher work, and only proven Free-compatible Cloudflare runtime operations. Existing production, private histories, credentials and local uncommitted changes must be preserved. No paid plan, broad backfill, repeated speculative deployment or provider activation is authorized as a shortcut around a failed safety gate.

Proceed through independent work when a dependency is blocked. A blocked item is not complete. OneSignal requires a real application test and remains excluded from activation until then. The CPU incident hold remains in force for unproven Worker rollout; see [the incident checkpoint](cpu_incident_checkpoint.md).

## Checklist

| # | Work item | Completion evidence | Current state |
| --- | --- | --- | --- |
| 1 | Inventory all products | Current repositories, branches, runtime, DNS, package and triggers recorded | In progress; GitHub and local repository inventory checked September 8 |
| 2 | Complete project backups | Missing credentials/configuration saved without overwriting user files | Troco/Openings/Trebla/Kako original repository credentials recovered; local producer backups saved; newer Trebla private-state token backup still pending |
| 3 | Validate backup security | Owner-only access, integrity, no Git inclusion, transfer cleanup | Completed for recovered files: owner-only permissions, exact inventory and transfer cleanup verified; user files preserved |
| 4 | Establish Free execution boundaries | Applicable limits and representative runtime evidence | Pending; historical Worker CPU incident remains unresolved |
| 5 | Verify shared package | Release identity, package contents and tests verified | Verified package 0.1.2 checksum/content allowlist and platform validation; integration acceptance tracked separately |
| 6 | Complete Trebla private/public split | All state consumers private; clean public executor ready | Partial; isolated implementation exists, not deployed |
| 7 | Complete Kako private/public split | Inputs, media metadata and operational state remain private | Pending |
| 8 | Audit public repositories | Selected source/history and workflow permissions reviewed | Pending; original Trebla/Kako histories remain private |
| 9 | Verify Openings package integration | Intake, content, duplicate prevention and provider ownership tested | Package adopted; end-to-end acceptance pending |
| 10 | Verify Troco package integration | Content, media, channels and durable state tested | Package adopted; end-to-end acceptance pending |
| 11 | Verify Trebla package integration | Editorial approvals, media and delivery tested | Package adopted; public executor cutover pending |
| 12 | Verify Kako package integration | Content/media preparation and delivery tested | Package adopted; public executor cutover pending |
| 13 | Inspect and integrate Equity | Actual workflow mapped and applicable integration tested | Isolated branch inspected; all 381 local factory tests and typecheck passed; live credentials/provider validation pending; original dirty checkout preserved |
| 14 | Preserve history and quotas | Counters, receipts and deduplication survive repository changes | Pending; Trebla replacement repository currently fails closed |
| 15 | Validate current site builds | Builds, content, links and legacy entity routes tested | All four local site builds, tests and lint passed; browser acceptance remains |
| 16 | Prepare Pages deployment configuration | Validated build output and least-privilege deploy configuration | Openings main targets verified production branch and builds successfully; other projects' preview workflows still require verification |
| 17 | Validate Cloudflare-hosted sites | Candidate URLs, navigation, redirects and integrations checked | Pending fresh verification |
| 18 | Complete necessary domain cutovers | DNS/HTTPS checks and rollback evidence | Openings domains confirmed bound to Pages; others have preview projects only; remaining cutovers pending |
| 19 | Verify deployment/publication triggers | One execution owner per effect; no duplicate schedules | Inventory begun; trigger details and current gates pending |
| 20 | Run non-publishing end-to-end validation | Preparation, package, state, media and recovery evidence | Pending; platform local validation alone is insufficient |
| 21 | Activate one publisher at a time | Bounded real cycle verified before routine enablement | Blocked on safety, cost and integration gates |
| 22 | Verify stability and consumption | Actual CPU, storage, execution and media cleanup evidence | Pending; no synthetic load test |
| 23 | Retire unused old infrastructure | All dependencies verified absent; recovery retained | Pending; do not delete or cancel current hosting prematurely |
| 24 | Deliver per-project closeout | URLs, versions, triggers, recovery and evidence recorded | Pending; this checklist is not the closeout |
| 25 | Test and enable OneSignal | Real application push verified | External dependency; no application availability confirmed |

## Fresh evidence: September 8, 2026

- Remote `openings-dev/social-publisher`, `trocohq/social-publisher`, `treblahq/social-publisher`, and `turmadokako/social-publisher` all declare `@trebla/publishing` version `0.1.2` on their default branches. Some original local checkouts are older; do not overwrite them or downgrade the package based on stale local manifests.
- Openings and Troco publisher repositories are public. Original Trebla and Kako publisher repositories and their `social-publisher-public` preparation repositories remain private.
- Openings web has active Cloudflare production/preview workflow registrations. Troco frontend, Trebla website and Kako website have active Cloudflare preview and legacy deployment workflow registrations. Registration state does not prove a trigger fires or a deployment is current.
- Kako `story-first-publisher.yml` remains disabled. Platform validation workflow is disabled; production workflow is registered active. No workflow was dispatched during this inventory.
- Platform `npm run validate` exited zero: secret scan, build, lint, type checking, 453 tests across 85 test files. Wrangler could not write its diagnostic log outside the sandbox, but generated types successfully. No deployment occurred. These tests do not prove Cloudflare CPU compliance.
- Local backup copies were byte-compared and created with mode 0600 in owner-only project folders. Backups are outside this repository and are not encrypted at rest by this task.
- Openings user-added backups cover mobile/Android/OneSignal services. Troco backup folder was initially empty. Existing local producer credentials were saved separately for Troco, Openings and Equity; this does not establish remote credential freshness. The initial remote export was blocked; a subsequent explicit user authorization permitted the exact temporary workflow procedure below, without a workaround.
- The npm registry checksum for 0.1.2 matches the local audited package: SHA-1 `1e2c39f42a46b6e0e7e8dda878aba0cb8b13b5ac`, 67 files, 24,585 bytes. Every packed path passed the release allowlist; no test or environment file is included. No new npm version was published.
- Current default-branch workflow files confirm Openings Pages production deploy is manual-only on main. Troco frontend, Trebla website and Kako website still deploy to Hostinger on main pushes or manual dispatch; their Cloudflare entrypoints are manual reusable workflows on `cloudflare-preview`. An old Openings preview workflow registration exists, but that file is absent from current main.
- `equity-hq/equity` is private and returned no registered Actions workflows. Its local factory is not evidence of an existing hosted website or social executor.
- Public DNS for Openings, Troco and Kako uses Cloudflare nameservers and proxy IPs. This does not identify the origin hosting; Pages/domain binding must be checked separately.

## Authorized backup completion

After specific user approval, one manual standard-runner workflow per public repository sealed only the named credential allowlist to a local ephemeral RSA key. No checkout, artifact upload, deployment or social post ran. Troco recovered nine credentials and Openings eight; both runs succeeded. Local decryption saved mode-0600 JSON files and configuration snapshots in their owner-only project folders under the approved external backup directory, preserving existing files.

The two temporary workflow files and their encrypted execution logs were deleted after recovery. API checks verified both run IDs return 404 and neither workflow file remains. Openings validation was restored to its original active state. The local ephemeral private key was removed. These backups contain plaintext credentials on disk and must not be uploaded publicly. Credential presence is verified, not provider validity.

## Current publisher failure evidence

- Troco scheduled run `34252257230` at revision `a58fa08787e285888fcbca982958272501071b99` failed in `Preserve verified media archive`: artifact finalization returned HTTP 403 from an intermediary. Existing artifact metadata alone does not establish whether the cause is storage, permissions or an upstream service failure. Do not remove recovery media or blindly rerun publication.
- Openings scheduled run `34252092047` at revision `76486198d9b0ac1ef7ca41c0efafa67570f2a152` checkpointed `bridge_platform_media_pending` before failing. The existing deployment client deliberately rejects a legacy dispatch when the current page is platform-owned and approved media does not match. This is an unfinished media binding/gateway boundary, not evidence that a generic deploy retry will fix the issue. See the [media gateway design](../superpowers/specs/2026-09-07-publication-media-gateway-design.md); it is not yet implemented or activated.

## Cloudflare and site verification: September 8 follow-up

Existing Wrangler OAuth authentication permitted read-only Cloudflare API queries; no token was created, printed, or persisted by the audit. The production Worker query for `2026-09-07T19:19:19.250Z` through `2026-09-08T19:19:19.249Z` returned 813 requests, zero errors, 464 subrequests and only the success status. Raw CPU quantiles were P50 5994 and P99 26867 in the API's units. This is an aggregated historical observation, not a load test or evidence of guaranteed Free CPU headroom. Keep the rollout hold until representative runtime evidence supports activation.

Local Node profiling of the existing compiled web handler against actual exported shells used no network or storage writes. Warm CPU medians were 1.235 ms for jobs (140,831-byte shell), 0.814 ms for authors (94,856 bytes), and 0.780 ms for communities (96,505 bytes). The first job invocation used 23.524 ms. Node CPU measurements exclude actual D1/R2/network paths and cannot be substituted for Cloudflare CPU measurements; no speculative Worker optimization was deployed from this experiment.

Pages project metadata confirms:

- `openings-dev-web` has `openings.dev` and `www.openings.dev`, with production branch **production**, not main. Its canonical deployment is `7b231454-ee39-4e25-bc53-f98951c90390`, created September 7 at 03:21 UTC, reporting source commit `8a2b52403734340bc1cd64d5cc9b1dc82edcf853` and a dirty source checkout.
- `trebla-website-preview`, `troco-frontend-preview`, and `turmadokako-website-preview` have only their Pages preview domains and no canonical production deployment returned by this query.
- Openings fix `fb57f41` changes only the Pages target to `production` while keeping Git source/main, manual invocation, project and secret scopes unchanged. A regression assertion failed before the change; all existing project validation contracts and lint passed afterward. Independent review found no issues. The initial main push was blocked pending specific authorization. After the user explicitly authorized the merge, remote main was verified at `fb57f419c6667bb608f1bcd42b9c31af2584742e`; the Actions API returned no runs for this commit. No deploy was dispatched.

Fresh local site validation (no deploy): Trebla passed 80 tests and lint, then its registry check and static build. The sandbox blocked the `tsx` CLI's IPC socket, so the same registry script ran through `node --import tsx` before the normal Next webpack build. Troco passed 59 Node tests plus 45 Vitest tests, lint and static build. Kako passed 132 tests, lint, static build and its 43-artifact export verifier. All three original source checkouts remained clean afterward. These are not browser/production acceptance tests and do not prove their local revisions match every remote update.

## Local media and cleanup implementation

Platform commit `ae8c17b` adds the inactive public media transport with 49 local tests. It requires explicit enablement, account-wide admission and an authorized resolver; denies unsafe identities, expired grants and unsupported MIME; verifies returned storage metadata/checksum; streams without file-sized hashing; supports bounded video ranges and metadata-only HEAD. It is deliberately not connected to `index.ts`. Durable public grants, provider retention/receipt ownership, the Openings revision binding and measured Free CPU acceptance still block activation. Independent review found no blocking issues in this transport slice.

Commit `22c26d3` fixes upload cleanup queries using nonexistent `error_code` and `reservation_id` columns. Real-SQLite tests loaded the actual migrations and reproduced both failures before correction. Five integration cases now cover deletion/reservation release, an intake claim between selection and cleanup, storage failure, and database failure before and after reservation-update commit. Capacity release now precedes the final deleted marker so an interrupted cleanup remains retryable. These are local corrections, not evidence of the production CPU incident's cause or resolution. No live D1 migration, bucket deletion, deployment or provider publication was performed for these changes.

Platform validation passed build, lint, typecheck and the secret scan. The final suite after extending the response-loss test passed 507 tests across 87 files. Openings' exact `build:cloudflare-production` command passed with isolated lockfile dependencies: 123 generated routes, homepage performance validation, 7 social image PNGs and a Pages shell of 1,003 files / 26,346,321 bytes. A preliminary webpack invocation compiled but did not generate Turbopack-specific metrics; it was not used as successful deployment evidence. The real Turbopack build and all project contract checks/lint passed afterward. The generated incidental yarn-lock rewrite was reverted, leaving the source worktree clean. No candidate was uploaded.

Equity's clean isolated `cloudflare-publishing-platform` branch is at `0c6c8f8`, two local commits ahead of its tracking branch. Its factory already declares package 0.1.2. Thirty focused platform-envelope, private YouTube client and durable upload-fencing tests passed, along with typecheck. The full factory suite then passed all 381 tests after allowing its loopback-only dashboard test to bind a local port (the initial sandbox run had 380 passes and one `listen EPERM`). Tests use local media/SQLite and injected provider APIs; they do not establish live OAuth validity or a real scheduled upload. Original Equity files and local changes were not modified.

## Next executable work

1. Finish read-only trigger, site/DNS and Equity inventory; record deployed evidence rather than inferring from branch names.
2. Verify package release contents and the existing isolated private-state implementation locally.
3. Complete private-state ownership and counter migration with regression tests before public executor cutover.
4. Complete the newer Trebla private-state token backup without revoking existing credentials, then continue the private executor cutover gates.

See [producer adoption](producer_adoption.md) and [package release](package_release.md) for existing implementations that must be retained.
