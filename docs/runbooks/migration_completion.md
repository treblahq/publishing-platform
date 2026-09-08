# Migration Completion Checklist

> Track the approved 25-step migration against fresh evidence, without exposing credentials or equating local tests with production readiness.

## Operating constraints

The approved target is Cloudflare Pages for sites, standard public GitHub Actions runners for heavy publisher work, and only proven Free-compatible Cloudflare runtime operations. Existing production, private histories, credentials and local uncommitted changes must be preserved. No paid plan, broad backfill, repeated speculative deployment or provider activation is authorized as a shortcut around a failed safety gate.

Proceed through independent work when a dependency is blocked. A blocked item is not complete. OneSignal requires a real application test and remains excluded from activation until then. The CPU incident hold remains in force for unproven Worker rollout; see [the incident checkpoint](cpu_incident_checkpoint.md).

## Checklist

| # | Work item | Completion evidence | Current state |
| --- | --- | --- | --- |
| 1 | Inventory all products | Current repositories, branches, runtime, DNS, package and triggers recorded | In progress; GitHub and local repository inventory checked September 8 |
| 2 | Complete project backups | Missing credentials/configuration saved without overwriting user files | Partial; Trebla/Kako recovered, platform local files copied; local producer credentials saved for Troco/Openings/Equity; social-provider remote export blocked |
| 3 | Validate backup security | Owner-only access, integrity, no Git inclusion, transfer cleanup | Partial; copied files verified; user-added mobile files preserved |
| 4 | Establish Free execution boundaries | Applicable limits and representative runtime evidence | Pending; historical Worker CPU incident remains unresolved |
| 5 | Verify shared package | Release identity, package contents and tests verified | Verified package 0.1.2 checksum/content allowlist and platform validation; integration acceptance tracked separately |
| 6 | Complete Trebla private/public split | All state consumers private; clean public executor ready | Partial; isolated implementation exists, not deployed |
| 7 | Complete Kako private/public split | Inputs, media metadata and operational state remain private | Pending |
| 8 | Audit public repositories | Selected source/history and workflow permissions reviewed | Pending; original Trebla/Kako histories remain private |
| 9 | Verify Openings package integration | Intake, content, duplicate prevention and provider ownership tested | Package adopted; end-to-end acceptance pending |
| 10 | Verify Troco package integration | Content, media, channels and durable state tested | Package adopted; end-to-end acceptance pending |
| 11 | Verify Trebla package integration | Editorial approvals, media and delivery tested | Package adopted; public executor cutover pending |
| 12 | Verify Kako package integration | Content/media preparation and delivery tested | Package adopted; public executor cutover pending |
| 13 | Inspect and integrate Equity | Actual workflow mapped and applicable integration tested | Pending; original local checkout has uncommitted changes |
| 14 | Preserve history and quotas | Counters, receipts and deduplication survive repository changes | Pending; Trebla replacement repository currently fails closed |
| 15 | Validate current site builds | Builds, content, links and legacy entity routes tested | Pending |
| 16 | Prepare Pages deployment configuration | Validated build output and least-privilege deploy configuration | Pending verification; existing preview workflows found |
| 17 | Validate Cloudflare-hosted sites | Candidate URLs, navigation, redirects and integrations checked | Pending fresh verification |
| 18 | Complete necessary domain cutovers | DNS/HTTPS checks and rollback evidence | Pending; do not assume current DNS from workflow names |
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
- Openings user-added backups cover mobile/Android/OneSignal services, not the complete social-provider credentials. Troco backup folder was initially empty. Existing local producer credentials were subsequently saved separately for Troco, Openings and Equity; this does not establish remote credential freshness. Remote social credential export was rejected by the environment security gate; do not retry through an indirect method.
- The npm registry checksum for 0.1.2 matches the local audited package: SHA-1 `1e2c39f42a46b6e0e7e8dda878aba0cb8b13b5ac`, 67 files, 24,585 bytes. Every packed path passed the release allowlist; no test or environment file is included. No new npm version was published.
- Current default-branch workflow files confirm Openings Pages production deploy is manual-only on main. Troco frontend, Trebla website and Kako website still deploy to Hostinger on main pushes or manual dispatch; their Cloudflare entrypoints are manual reusable workflows on `cloudflare-preview`. An old Openings preview workflow registration exists, but that file is absent from current main.
- `equity-hq/equity` is private and returned no registered Actions workflows. Its local factory is not evidence of an existing hosted website or social executor.
- Public DNS for Openings, Troco and Kako uses Cloudflare nameservers and proxy IPs. This does not identify the origin hosting; Pages/domain binding must be checked separately.

## Next executable work

1. Finish read-only trigger, site/DNS and Equity inventory; record deployed evidence rather than inferring from branch names.
2. Verify package release contents and the existing isolated private-state implementation locally.
3. Complete private-state ownership and counter migration with regression tests before public executor cutover.
4. Obtain the required specific authorization for the rejected credential export, or use user-supplied local credential files. Existing secrets must not be revoked to manufacture a backup.

See [producer adoption](producer_adoption.md) and [package release](package_release.md) for existing implementations that must be retained.
