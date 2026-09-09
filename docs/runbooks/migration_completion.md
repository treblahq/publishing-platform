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
| 5 | Verify shared package | Release identity, package contents and tests verified | Released 0.1.3 checksum/content allowlist and clean Node 20 installation verified; integration acceptance tracked separately |
| 6 | Complete Trebla private/public split | All state consumers private; clean public executor ready | Partial; isolated implementation exists, not deployed |
| 7 | Complete Kako private/public split | Inputs, media metadata and operational state remain private | Explicit completed-release descriptor adopted; all 140 media files and replay verified; state token, editorial source separation and public executor cutover pending |
| 8 | Audit public repositories | Selected source/history and workflow permissions reviewed | Partial: read-only selected-code inventory passed for Trebla/Kako; full history, private input and public workflow boundaries remain unapproved |
| 9 | Verify Openings package integration | Intake, content, duplicate prevention and provider ownership tested | Package adopted; end-to-end acceptance pending |
| 10 | Verify Troco package integration | Content, media, channels and durable state tested | Package adopted; end-to-end acceptance pending |
| 11 | Verify Trebla package integration | Editorial approvals, media and delivery tested | Package adopted; public executor cutover pending |
| 12 | Verify Kako package integration | Content/media preparation and delivery tested | Package adopted; public executor cutover pending |
| 13 | Inspect and integrate Equity | Actual workflow mapped and applicable integration tested | Receipt projection integrated into main f31e1e7 after fresh 446 tests and typecheck; durable local executor retained; live credentials/provider validation and durable platform reporting pending; original dirty checkout preserved |
| 14 | Preserve history and quotas | Counters, receipts and deduplication survive repository changes | Trebla read-only migration bridge implemented and reviewed locally; actual freeze/drain/reconciliation record and cutover still pending |
| 15 | Validate current site builds | Builds, content, links and legacy entity routes tested | All four local site builds, tests and lint passed; browser acceptance remains |
| 16 | Prepare Pages deployment configuration | Validated build output and least-privilege deploy configuration | Openings main targets verified production; Trebla/Troco/Kako guarded manual production workflows now integrated into main after fresh local tests/builds; environment protection and package access verification remain before activation |
| 17 | Validate Cloudflare-hosted sites | Candidate URLs, navigation, redirects and integrations checked | Production Pages candidates: Troco eight redirects/five pages; Trebla ten routes; Kako four redirects/33 routes passed; complete browser/integration acceptance pending |
| 18 | Complete necessary domain cutovers | DNS/HTTPS checks and rollback evidence | Openings domains bound to Pages; Troco/Trebla/Kako apex and www Active with SSL September 9, production checks passed; Trebla .com.br redirect origin deliberately preserved pending its separate migration |
| 19 | Verify deployment/publication triggers | One execution owner per effect; no duplicate schedules | Current main workflow/API inventory recorded September 9; exclusive provider ownership and cutover gates still pending |
| 20 | Run non-publishing end-to-end validation | Preparation, package, state, media and recovery evidence | Real local Worker and fresh-producer lost-acceptance recovery passed with zero reuploads and no duplicate rows; product/native-provider and public gateway acceptance remain pending |
| 21 | Activate one publisher at a time | Bounded real cycle verified before routine enablement | Blocked on safety, cost and integration gates |
| 22 | Verify stability and consumption | Actual CPU, storage, execution and media cleanup evidence | Pending; no synthetic load test |
| 23 | Retire unused old infrastructure | All dependencies verified absent; recovery retained | Pending; do not delete or cancel current hosting prematurely |
| 24 | Deliver per-project closeout | URLs, versions, triggers, recovery and evidence recorded | Pending; this checklist is not the closeout |
| 25 | Test and enable OneSignal | Real application push verified | Explicitly deferred by the user; excluded from the current completion scope |

## Fresh evidence: September 8, 2026

### September 9 release and deployment follow-up

#### Kako canonical cutover and static behavior

The existing `turmadokako-website-preview` production now serves
`turmadokako.com`, whose binding reports Active and SSL enabled. Both apex and
www DNS now use proxied CNAMEs to that Pages hostname. The original apex A
`212.1.209.199` and AAAA `2a02:4780:1:793:0:24b8:e5ab:a` became one CNAME;
www previously aliased the apex. The dashboard count consequently changed from
14 to 13, with FTP, mail and verification records preserved. Fresh matching
14-query DNS snapshots reported no protected changes. Original web records and
rollback instructions are saved privately; do not remove old hosting.

One narrowly scoped Single Redirect preserves original www canonicalization:
`http.host eq "www.turmadokako.com"` excluding paths beginning
`/.well-known/acme-challenge/`, dynamic target
`concat("https://turmadokako.com", http.request.uri.path)`, status 301, query
preservation enabled. It was saved disabled before activation; the rule list
had no other active redirect rules. The generic wildcard template produced a
DNS applicability warning, so it was cancelled and replaced with this explicit
host condition, not blindly deployed. The rule uses the existing Free feature,
not a Worker. See [Single Redirects availability](https://developers.cloudflare.com/rules/url-forwarding/)
and [settings](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/).

Fresh HTTP/HTTPS www blog requests redirect to the exact canonical path/query.
Home/blog returned 200 and both Lola redirects retained their existing external
destinations/query without following those destinations. All 33 exported index
routes matched the candidate after accounting for existing Cloudflare email
obfuscation. Home initially differed because plain email text was transformed
into a protected anchor; decoding that exact transform confirmed equivalence.

Five retired product/campaign routes intentionally remain unavailable as true
404 responses under the static Pages target instead of Apache's 410. The
retired products remain absent from the export and sitemap; this is not exact
HTTP-status parity. No runtime was added solely for that distinction.

The initial redirect also intercepted Pages certificate validation. A fresh
ACME diagnostic returned 301 to the apex, reproducing the documented blocker.
The existing rule was corrected to exclude only the ACME path prefix. Fresh
HTTP/HTTPS challenge probes now return 404 without Location, while the normal
www blog still returns the expected 301 with query. A new DNS verification was
requested after that correction. See [Pages HTTP validation](https://developers.cloudflare.com/pages/configuration/debugging-pages/#blocked-http-validation).
The subsequent dashboard check confirmed www Active and SSL enabled as well.
Both Kako bindings now have direct dashboard confirmation, not only ordinary
HTTPS evidence.
No build, publisher call, Worker deployment, paid option or hosting retirement
occurred during this cutover. Public executor and repeatable workflow activation
remain separate pending items.

#### Trebla canonical domain cutover

`treb.la` and `www.treb.la` are now bound to the existing production Pages
deployment of `trebla-website-preview`; both report Active and SSL enabled.
Only their original proxied A records (`212.1.209.199`) were replaced by
proxied CNAMEs to `trebla-website-preview.pages.dev`. The refreshed dashboard
still has all 12 records; `goal`, domain-connect and email configuration remain
unchanged. Fresh before/after DNS comparisons for both Trebla zones reported no
protected changes. Restore the original two A records for rollback.

Four HTTPS GET checks passed for apex/www home and blog. All ten exported
index routes on the canonical domain returned 200 and matched the Pages
candidate after decoding the existing Cloudflare email-obfuscation transform
and removing its decoder script. Raw HTML comparison initially differed for
that reason; it was not a stale build. The candidate's actual nonexistent route
still returns 404, independently of exported error-template paths.

`trebla.com.br` and `www.trebla.com.br` were deliberately left untouched on
their original origin. Their apex A/AAAA and www CNAME do not depend on the
changed `treb.la` DNS. Four fresh requests confirmed the existing 308 to
`https://treb.la/`, including the existing removal of path/query. Migrating this
alias behavior and retiring its origin remain pending. Pages also normalizes
`/blog` with 308 instead of the previous 301 and redirects `/index.html` to `/`;
normal content routes and query preservation were checked before cutover.
No new build, Worker, Actions run, paid plan or Hostinger cancellation occurred.

#### Troco production domain cutover

The existing validated production deployment of `troco-frontend-preview` now
serves `troco.net` and `www.troco.net`. Both custom domains report Active with
SSL enabled. Fresh HTTPS GET requests to `/`, `/calculate/` and `/blog/` on
both hosts returned 200 with the expected Pages content. No new build,
publisher dispatch, Worker deployment or paid option was used.

Only the two web DNS records changed: apex A `212.1.209.199` and www CNAME
`troco.net` became proxied CNAMEs to `troco-frontend-preview.pages.dev`.
The refreshed dashboard still contains all 16 records, including unchanged
mail, DKIM, SPF, DMARC, Resend and managed newsletter Worker records. The
17-query before/after DNS comparison reported no protected changes; proxied
web records can retain identical public DNS answers, so the dashboard is the
evidence of origin replacement. Private snapshots remain outside Git under
the Troco backup directory. Restore the two original web records for rollback;
do not cancel Hostinger while email and other dependencies remain.

#### Fenced public-media approval issuance

The internal issuer now creates immutable approvals only with an available
temporary artifact, unsafe same-tenant reference, enabled tenant and explicit
adapter control, and a current matching delivery lease. INSERT and exact replay
share the same eligibility fence. Expiry is bounded locally to seven days and
does not prove provider ingestion. Neither insertion nor replay acquires or
releases retention, extends existing approvals or revives tombstoned bytes.

The 101 focused tests cover real cleanup interleavings, failed bucket deletion,
lost INSERT responses, exact replay, resolver composition and stale ownership.
Quality review found an input mutation race between the two statements; a
captured six-field snapshot and two red/green regressions close it. Independent
specification and quality reviews approved the component. Fresh full validation
passed 1,091 tests across 99 files, build, lint, typechecking and secret scan.
No route activation or remote migration occurred. Account allocation
provisioning, denial costs, native ownership, HTTP integration and Free CPU
acceptance remain separate open gates.

#### Provider acceptance versus cleanup

Cleanup now retains an unsafe provider reference with a same-tenant durable
receipt or public-media approval. Expired/revoked grants and old terminal states
are not proof of ingestion. The protection applies before candidate selection
and again at the atomic tombstone claim, including staged/tombstoned retries.
It does not extend grant expiry, expose files, restore deleted bytes or alter
unaccepted/unreferenced artifact retention. Once all protected references are
explicitly safe, existing cleanup eligibility applies again.

Six failing real-SQLite cases reproduced premature deletion before the fix.
Final tests also cover grant creation between selection and claim and the final
outstanding reference among multiple providers. Full verification passed 990
tests across 98 files, build, lint, types and secret scan. Independent review
approved the boundary. Additional indexed reads are not certified production
costs. Stuck accepted work may retain storage and must be reconciled; capacity
pressure must not be resolved by silently deleting still-needed media.

The cleanup change closes the collector side; the subsequent internal issuer
above closes the atomic grant-creation fence. Neither component has been
activated remotely, and no provider call occurred during these validations.

#### Finite public-media admission

The internal public-media admission component now uses one account-shared finite
allocation and a single conditional UPDATE reserving D1 reads, D1 writes and R2
Class B work together. It denies missing, disabled, expired, depleted or
uncertain allocations; counters persist across fresh callers and are never
refunded or reset on the public path. Migration 0011 creates no live allocation.
The component is not wired into the production router.

All 81 real-SQLite tests passed, including exact exhaustion, multi-resource
atomicity, shared tenant callers, expiry/day boundaries, response loss and HTTP
transport composition. A denied reservation reached neither resolver nor bucket;
downstream failure after admission kept its reservation consumed. Full platform
validation passed 982 tests across 98 files, build, lint, types and secret scan.
Independent specification and quality reviews approved the component.

A separate local EXPLAIN QUERY PLAN check of the real public-grant resolver
showed indexed lookups across artifacts, adapter controls, tenants, grants,
references and deliveries. This is not measured D1 billing or an upper bound on
matching grant rows. The two-read cost floor must not become an assumed deployed
cost. Exclusive measured account allocation provisioning, denied-request/abuse
bounds, conservative resolver costs, native ownership, grant/cleanup acceptance
and representative Free CPU evidence still block route activation.

#### Initial provider receipt ownership

Equity's previously isolated pure receipt projection is now on main `f31e1e7`,
based on freshly fetched `6551eec`. Only the projection, its tests and existing
implementation plan were integrated. Fresh verification passed 446 tests and
typecheck, followed by independent integration review. Package 0.1.3 remains
unchanged. SQLite retains ownership; private/scheduled videos receive no public
URL, no CLI/runtime caller was activated, and nothing was uploaded or scheduled.
This is not durable platform reporting or native-provider live acceptance.

Initial delivery now checks that the returned receipt belongs to the resolved
adapter, matching reconciliation's existing identity boundary. A foreign
provider receipt previously passed shape validation and could mark synchronous
work verified, asynchronous work processing, and invoke media-retention release.
Both paths were reproduced by failing tests before the guard was added. They
now enter `needs_attention` without retaining the foreign receipt, calling
retention, or scheduling an automatic retry. Nineteen focused consumer and
reconciliation tests passed; full validation passed 901 tests across 97 files,
build, lint, types and secret scanning. Independent review approved the change.
This closes an internal receipt boundary, not native-provider cutover or public
media gateway acceptance. No deployment or external provider call was made.

#### Current publisher trigger inventory

GitHub workflow state and current main YAML were read without dispatching or
changing any workflow. These are configured triggers, not proof of successful
delivery or permission to enable another execution owner. Schedule times below
are UTC.

| Product | Configured main triggers | Current observed gate/state |
| --- | --- | --- |
| Openings | Social intake every two hours at minute 17; editorial Monday/Wednesday/Friday 15:17; manual alternatives | Both active; editorial auto-publish variable true; both share `social-publisher-publication` concurrency; intake still encounters the media bridge boundary |
| Troco | Every three hours at minute 17 and manual execution | Active; one `troco-social-publication` group with main-branch guard; existing publication-health failure remains |
| Trebla | Scout every six hours at minute 17; weekly Monday 12:17; PR/manual editorial and blog delivery; repository-dispatch release workflows | Workflows active; scout, weekly and heavy-runtime variables true; auto-release true, but general social-publishing and zero-cost-confirmed repository variables absent in this read; per-job conditions still apply; private repository consumes included runner minutes |
| Kako | Curated publisher has six daily scheduled slots and manual execution; bootstrap, activation, snapshots and dry-run workflows manual | Curated publisher disabled manually; other manual workflows active; activation/bootstrap/curated share `story-first-production`; no activation performed |
| Equity | No GitHub Actions workflows returned | Existing local/native executor remains; absence of Actions is not verification of local scheduler state |

Openings credential-transfer workflow remains disabled manually. Validation
workflows are separate from provider publication. Do not infer global mutual
exclusion from concurrency groups scoped to individual repositories; actual
native-provider owner reconciliation remains a cutover requirement.

#### Static-site deployment activation gates

The DNS comparator now rejects malformed baselines, duplicate case-insensitive
query keys and mismatched query coverage. Capture deduplicates queries before
requests; malformed JSON errors do not echo evidence contents. All 111 focused
tests and full validation (899 tests across 97 files, build, lint, types and
secret scanning) passed, followed by independent specification and quality
reviews. New owner-only `*-2026-09-09-validated-v2.json` baselines preserve the
older files and contain 14 unique record sets for trocofacil.app, 17 for
troco.net, 13 for treb.la, 14 for trebla.com.br and 14 for turmadokako.com.
Each passed shape/coverage self-validation; that is not cutover or propagation
acceptance. No DNS records or deployments were changed.

Read-only GitHub checks after main integration confirm that all three website
repositories remain private. Each has only `cloudflare-preview`, with no
deployment protection rules or branch policy; `cloudflare-production` does not
exist yet. Repository variables contain no Cloudflare activation settings, and
repository secrets contain FTP credentials only, not Cloudflare credentials.
No environment, permission, secret or activation variable was changed.

The manual production workflows therefore remain inactive. Running their builds
on these private repositories would consume included Actions minutes; adopting
the workflow alone does not establish the intended public-runner cost boundary.
Do not dispatch speculative builds or describe these sites as having an active
automated Pages production deployment. Keep the already-validated Pages
candidates and current Hostinger production intact while resolving the execution
and credential boundary.

Lockfile inspection found only npmjs registry dependencies for Trebla. Troco
depends on GitHub Packages `@trocohq/core` and `@trocohq/design-tokens`; Kako
depends on `@turmadokako/runner-core` and `@turmadokako/web-ui`. GitHub metadata
confirms all four packages are private. Their production workflows configure
the GitHub registry and use the job token for installation, but local cached
installation is not proof that a fresh job token has package access. Do not
make these packages public or copy them into public executor output merely to
bypass authentication or included-minute limits.

#### Current private-release and Troco diagnostic follow-up

##### September 9 DNS acceptance and Openings package main integration

DNS response validation now rejects unsuccessful/malformed status, truncation,
malformed answers and contradictory NXDOMAIN data. Matching numeric record
types are selected without relabeling CNAME chains. Requests use a 15-second
abort signal and a 256 KiB streaming cap; opaque TXT/CAA values remain intact.
All 57 focused tests and full validation (845 tests across 97 files, build,
lint, types and secret scanning) passed, followed by independent specification
and quality reviews. Commit `1f89b8d` contains the guard and verified plan.

Fresh public-DNS baselines were captured at 13:04 UTC for `trocofacil.app`
(18 record sets), `treb.la` (17), `trebla.com.br` (20), and `turmadokako.com`
(19). Files are saved exclusively in the respective external project docs
folders with mode 0600. Queries included supported types from the private UI
inventories, including mail records. These are public resolver observations,
not authoritative origin exports or proof of completed DNS propagation. No
DNS record was changed and no Worker execution was invoked by these queries.

Openings social-publisher main now includes merge `5b61653`: only package.json
and its lockfile change relative to prior main `c1c9ead`, adopting the verified
registry package 0.1.3. A clean offline dependency installation followed by
validation passed 27 platform tests, 42 artwork/title/state tests and 165
deterministic contracts. The push used `[skip ci]`; no workflow was dispatched.
This package adoption does not resolve the separate pending media bridge or
establish end-to-end provider acceptance.

Troco main now contains package adoption `d1f27a6` and reviewed retention fix
`54ba5e2`. Relative to prior main `c25798f`, persisted state and workflows are
byte-identical. Package-only validation passed 182 tests; the final retention
integration passed 192 tests, formatting, typecheck and catalog validation
(20 tracked campaigns, three provider contracts). A fresh isolated dependency
installation initially lacked FFmpeg because install scripts were disabled;
the scoped FFmpeg rebuild restored the local prerequisite before final checks.
Independent integration review confirmed the exact previously reviewed patch.
In-flight media now remains available regardless of campaign age; actual media
and metadata are bounded before candidate replacement. No old post was retried,
provider error cleared or deployment dispatched. Both pushes used `[skip ci]`.

Bounded Troco Pages browser checks additionally verified the R$ 100.00 minus
R$ 82.65 calculation (R$ 17.35), denomination details with both banknote images
loaded, and insufficient payment (R$ 32.65 remaining). No browser error was
recorded. These supplement earlier route checks, not provider acceptance.

Fresh run metadata still shows Openings `34344980444` failing its preserved
intake-error step (`bridge_platform_media_pending`) and Troco `34345276763`
failing publication health. Neither run was rerun. Package adoption and media
retention must not be presented as clearing those existing operational failures.

Trebla package-only main adoption `f33e71d` is based on current remote main
`8b2490c`; a fresh isolated installation passed all 1,651 tests across 132 files,
lint, build and all three publication-boundary checks. Equity package-only main
adoption `6551eec`, based on `0c6c8f8`, passed 381 tests and typecheck after a
fresh isolated installation. Both change only the dependency declaration and
lockfile, preserve existing execution/state/credential behavior, and use
`[skip ci]`. Original local checkouts remain untouched. The larger isolated
private-state and receipt-projection changes are not included in these package
adoptions and remain pending separately.

The three static-site mains now include the guarded manual Pages workflows:
Trebla `61eaa6e` (100 tests; 101 exported files), Troco `600fa92` (62 Node tests
plus 45 Vitest tests; 375 files), and Kako `1dbf070` (135 tests; 916 files and
43 canonical artifacts verified). Fresh lint/build/static guards passed for
each, and independent review found no blockers. These are fast-forward
integrations of the previously reviewed isolated changes, not new deployments.
Existing Hostinger workflows remain unchanged. Each pushed tip starts with
`[skip ci]`, covering GitHub and the documented Pages skip-prefix behavior.
Fresh Actions metadata still showed the September 6 runs for all three sites,
not runs from these integrations. No enablement variable, secret, environment
protection, domain or deployment was changed. Production activation still
requires the remaining environment and domain checks.

A bounded local history scan also examined every blob reachable from the
locally available origin refs of the two already-public publishers. Troco:
765 text blobs (5,002,339 bytes) plus three MP3 blobs, compared against six
known secret values and the shared key-pattern scanner. Openings: 1,180 text
blobs (110,669,796 bytes) plus two MP3 blobs, compared against seven known
secret values and the same scanner. No matches were found, and no secret value
was printed. This is not proof against unknown/encoded credentials, unpublished
or unavailable refs, Actions logs/artifacts, or private editorial information.
It does not approve changing Trebla/Kako repository visibility.

Kako package-only main adoption `0f360c1` is based on `d98a32b`. The stale main
compiler identity regression failed first; the actual 191-artifact collector
then produced `24c9c9ea71141a758709bf3f61f153b4d939d35b231c2ca7b20265ecc0f3d729`
for the package-updated main sources. An independent review recomputed the same
identity and verified registry integrity. All 16 focused tests and the complete
1,431-test suite passed with no failures/skips, followed by typecheck, lint and
diff checks (full suite 1,051.2 seconds). Only package.json, lockfile and the
generated identity constant changed; workflow, configuration and state files
remain untouched. Push used a leading `[skip ci]`. All five publisher remote
mains now declare 0.1.3; larger isolated migrations and live acceptance remain
separate from dependency adoption.

The Troco site source explicitly defines `https://troco.net` as canonical;
`trocofacil.app` remains the Android application identifier and an additional
zone. Authenticated DNS inventory now also covers all 16 displayed `troco.net`
entries, with a private mode-0600 snapshot and a fresh 17-query public baseline.
Its apex and www still target Hostinger. The existing `newsletter.troco.net`
managed Worker binding and Resend/SES/Hostinger mail records must remain intact.
Do not treat the earlier `trocofacil.app` backup as covering the canonical site
or overwrite the managed Worker entry during website cutover.

##### Approved live release completion, September 9

Subsequent full recovery through the actual publisher downloader verified all
140 files (292,457,017 bytes) against the reviewed candidate and explicit
version-two descriptor. The 284 initial HTTP requests include metadata and
asset redirects; the verified replay made only four metadata requests and zero
asset requests. Files are retained in the owner-only external Kako docs folder,
with size/hash checks, regular-file checks and no symlinks. This completes byte
recovery, not source hydration, current-date approval or provider activation.
The isolated committed-descriptor adoption passed all 1,450 tests and typecheck.
The full run then identified a redundant assertion in the new test; after
removing only that assertion, all 21 focused tests, typecheck, lint and diff
checks passed. Independent specification and quality reviews passed. No runtime
logic was changed in descriptor adoption and the production workflow remains off.

DNS guard correction `dd4bb69` now preserves opaque TXT/CAA data instead of
lowercasing tokens or stripping their quotes/periods. Case-only verification and
DKIM mutations now block the real comparison. Full platform validation passed
801 tests across 97 files, build, lint, types and secret scanning; both independent
reviews passed. Capture fresh baselines before a cutover: old normalized files
cannot recover lost case. DNS response status and answer-type filtering still
require review before treating capture as a complete fail-closed boundary.

Authenticated Cloudflare UI access also permitted DNS record inventory without
a new token. Private JSON snapshots now cover all displayed records in
`trocofacil.app` (12), `treb.la` (12), `trebla.com.br` (26, both pages), and
`turmadokako.com` (14). These are DNS values/proxy/TTL snapshots, not full zone
settings exports. No DNS record was changed. Existing Hostinger dependencies
include Troco `links`/`marca`, Trebla `goal`/`tools`, FTP and mail services;
website cutover alone does not justify retiring the entire hosting service.

After specific owner approval, release `383205199` was completed at
`2026-09-09T12:05:07Z`, with `make_latest=false`. Repository ID `1349928184`
remained private under `turmadokako/social-publisher`; its tag and 140 assets
were preserved. The main-branch workflow files were checked before mutation:
none subscribed to release events. The curated publisher remained
`disabled_manually` afterward, and the latest workflow run remained the
September 8 run `34261249813`; no new run was observed.

The dedicated source-read token successfully verified exact repository and
completed-release identity, plus all 140 asset IDs, names, sizes, MIME types and
uploaded states against the existing descriptor. The smallest asset was fetched
without forwarding authorization to the GitHub release-assets redirect, bounded
to its expected 562,766 bytes, and its SHA-256 matched. No media was saved locally.
This resolves the observed draft-access 403 for this completed release; it does
not establish integrity of every asset's bytes or full bootstrap readiness.

The production descriptor still uses version one and therefore intentionally
rejects the newly completed release. Next, adopt the explicit version-two
descriptor with this exact timestamp in the isolated branch and perform bounded
full media recovery before any workflow activation. Credentials were not widened;
no deploy, social post, repository visibility change or Cloudflare operation was
performed. Earlier notes below describe the preceding local-only checkpoint and
draft-access failure, not the current remote release state.

Kako commit `9c6f5db` adds explicit version-two descriptors for a completed
release in the same pinned private repository. Version one remains draft-only;
version two requires an exact whole-second UTC `releasePublishedAt`, verified
against remote `published_at`. Repository privacy/identity, asset inventory,
checksums, bounded transport and descriptor-specific cache checks are unchanged.
The existing production descriptor and remote draft remain unchanged.

Local verification passed 1,449 tests with zero failures or skips in 910.3
seconds, followed by typecheck, lint and diff checks. Independent review passed
23 release/workflow tests and found no defects. The compiler identity matched
the existing collector, and the known credential-pattern scan passed. These are
local implementation results, not evidence of live media access. Remote release
completion still needs specific approval because it changes access for existing
repository readers and can trigger notifications. No deployment, workflow
activation, credential expansion or media download was performed in this slice.

The owner generated `kako-publisher-private-source-read` with Contents read and
required Metadata read, scoped to the original private repository ID 1349928184,
expiring October 9, 2026. Its owner-only `.env` backup is outside Git at the
approved external project docs folder. The temporary encrypted transfer and
ephemeral private key were removed after byte/permission verification. Following
specific approval, `PUBLISHING_SOURCE_TOKEN` was added to the original private
repository's Actions secrets at `2026-09-09T11:07:35Z`. The curated workflow
remained `disabled_manually`; no workflow was dispatched.

Live source-token checks returned 200 for repository identity and package.json
on the integration branch. However, exact draft release 383205199 returned 403
twice: `Resource not accessible by personal access token`, despite the endpoint
advertising `contents=read`. The second response had 4,982 requests remaining,
so this evidence does not indicate primary rate-limit exhaustion. The existing
administrative session independently confirmed that the same release exists,
is a draft, has the expected tag and contains 140 assets. That administrative
credential was used only for diagnosis, never installed as the runtime fallback.

GitHub documents a push-access distinction for draft release listings in its
[release API reference](https://docs.github.com/en/rest/releases/releases#list-releases).
The observed draft-access restriction blocks this token's media bootstrap even
though source reads work. Full asset inventory and byte recovery are therefore
not verified with the new token. Do not silently grant write access, publish the
draft, weaken the draft-only validator or mark media recovery ready. A reviewed
private media-access design and the relevant explicit authority are still needed.

Kako's isolated branch now resolves the original private release repository by
immutable ID and accepts only its approved current/future names. Preparation uses
`PUBLISHING_SOURCE_TOKEN` with no executor-token fallback; public verification
receives no source credential. The 18 release/workflow tests and 43 CLI tests
passed, and an independent security review found no blockers. The runtime
compiler identity was regenerated with the existing collector and independently
matched against the final sources. Full verification passed 1,445 tests with zero
skips in 982.6 seconds, followed by typecheck, lint and diff checks. The known
credential-pattern scan also passed. Commit `2ed0c5d` was pushed only to
`cloudflare-publishing-cutover`; no workflow was dispatched or activated.

Fresh GitHub read-only queries returned the same latest publisher runs recorded
below. A bounded Buffer read matched all six original Facebook/YouTube IDs for
September 4–6, each still in `error`. Their recorded cause is unavailable public
media. Eight distinct exact asset URLs on `trocohq.github.io` currently return
HEAD 200, expected JPEG/MP4 MIME types and nonzero lengths (68,497–448,550 bytes).
This is current header availability, not a historical availability guarantee,
byte-hash validation or proof that Buffer can ingest them now. No state was
rewritten, error hidden, post edited/retried, workflow run or media redeployed.

The source access setup and activation hold are documented separately in Kako's
`docs/operations/private_bootstrap_source_access.md`. Source token provisioning,
private input hydration and public executor cutover remain separate work.

The platform main push succeeded through `427b7f9` after the user's continuation.
This resolves the previous push blocker, not the runtime deployment gates.
Official npm web login and separate publication security-key confirmation also
completed. The public registry now exposes 0.1.3 with matching SHA-1
`08b3fedd9ff0617c5df7d3e403c4fc310d249ca7`; a fresh Node 20 registry installation
passed. Adoption is being verified on the five isolated product branches, without
changing production mains or dispatching workflows.

The authenticated npm configuration was copied byte-for-byte to the owner's
requested external `docs/publishing-platform` backup folder as
`npm-auth-2026-09-09.npmrc`, without overwriting an existing file. The project
folder is mode 0700 and the copy is mode 0600. This is a plaintext credential
backup (including the registry entries already present in that configuration),
not an encrypted archive; it must remain outside Git and public storage.

Verified isolated adoption of the registry package:

| Product | Branch commit | Local evidence |
| --- | --- | --- |
| Troco | `feb5537` | 192 tests, formatting, typecheck and validation (19 campaigns/3 provider contracts) passed using the existing canonical BRAND_ROOT; latest production receipt preserved |
| Equity | `36fbc7e` | 446 tests and typecheck passed; videos and credentials remain local |
| Openings | `b023c3a` | 27 package tests, 42 artwork/title/state tests and 165 contracts passed with zero skips, after incorporating current main |
| Trebla | `e6bf778` | 1,781 tests, lint, build and all three publication-boundary checks passed; private-state CLI fixtures corrected in `812b7e6` |
| Kako | `8c7557c` | Package adoption `d7c3cfc`: 1,440 tests, typecheck and lint passed; final workflow changes separately passed all 38 workflow contracts and typecheck/lint |

The four earlier product tips were pushed only to their existing integration branches.
Trebla's two CLI shadow fixtures referenced the former public-state destination;
updating them to the existing private-state contract retained explicit refusal
of the broad executor token. Concurrent runs exposed cold-import test timeouts;
the isolated pipeline tests and subsequent full single-worker suite passed
without changing timeouts or production code.

Openings initially skipped the sibling-deploy checks. A detached worktree of
the current legacy deploy (`6b6fd31`) exposed a genuine title-renderer mismatch:
the integration branch had not incorporated the social-title changes on main.
Merge `b023c3a` preserves current main through `731354e`, including publication
receipts, while retaining package 0.1.3. The four formerly skipped checks now
pass, including byte-identical portable artwork. The legacy deploy's own four
tests and contract validator also passed; its main was not changed.

Troco merge `feb5537` preserves main's September 5 Instagram delivery receipt
without resetting Facebook/YouTube failures or repeating a post. The complete
check and validator passed again after this state-only synchronization.

Kako's initial 1,440-test run had twelve compiler-identity failures, not twelve
provider errors. Its committed identity intentionally includes package.json
and the dependency lock. The existing collector calculated the new identity
from all 191 implementation artifacts under Node 24.14.1; updating the generated
constant restored all sixteen focused identity/locking tests. The subsequent
full suite passed all 1,440 tests with zero skips in 993.8 seconds, followed by
typecheck and lint; no safety comparison was removed or weakened.

Kako `8c7557c` adds an early read-only identity comparison to CI and manual dry
runs, after dependency installation and before the expensive full verifier.
Two missing-step assertions failed before implementation; all 38 workflow
contracts passed afterward. The actual workflow command passed with the real
identity and rejected an injected stale identity with exit 1. It does not
regenerate or approve identity automatically. Workflow/test files changed while
the long suite was running, so its 1,440 count is the pre-addition suite; the
complete workflow suite and typecheck/lint were rerun on the final files.
No additional runtime compiler input changed in the preflight slice.

Read-only branch-run queries returned zero workflows for each publisher
integration branch at inspection time. No dispatch, rerun or production merge
was performed. Equity still has no registered GitHub Actions workflows.
No successful production deployment or live publisher recovery is claimed here.

### Additional mobile acceptance and private-boundary findings

At 390 px, the existing Trebla Pages candidate rendered its home, Design and
Privacy pages without horizontal overflow. Theme switching worked. All six
lazy social specimens loaded after navigating to the editorial section; an
unloaded offscreen image was not treated as a broken image. No browser error
was recorded during these checks.

The existing Kako Pages candidate's mobile menu opened its game submenu and
navigated to Nina Splash. Portrait orientation displayed its rotate-device
guard; at 844 x 390 the game started, muted and paused correctly. These checks
do not certify every game or external music/video provider and do not change
DNS, hosting or deployment ownership.

Read-only GitHub environment checks found only `cloudflare-preview` on each of
`treblahq/website`, `trocohq/frontend` and `turmadokako/website`, with no protection
rules and no deployment-branch policy. All three repositories are private. None
has a `CLOUDFLARE_PRODUCTION_ENABLED` Actions variable. Consequently the prepared
manual production workflows remain gated off; production environment, credential
scope and execution-budget acceptance are not complete. No environment, secret,
activation variable or workflow was changed during this inspection.

Read-only Kako source inventory found 299 tracked asset files and 349 content
files. Moving the state branch alone cannot make this history safe to publish.
In addition, `src/daily-pairs/bootstrap-release.ts` verifies and addresses only
the current private repository name, while `scripts/bootstrap-pair-media.ts`
uses the executor token for release downloads and reads private configuration
from the executor checkout. Future rename-safe release access and private input
hydration must preserve immutable repository identity, byte hashes, draft
release checks and retention. No rename or visibility change was attempted.

The existing read-only `audit-public-snapshot.mjs` verified selected committed
source/scripts against exact SHA256 and the known credential-pattern scanner:

| Repository snapshot | Selected files | Bytes | Excluded files |
| --- | --- | --- | --- |
| Trebla `e6bf7783330e21117a1cc46b67d8f063c5f5173c` | 150 | 1,188,887 | 261 |
| Kako `accf1c7c846b0a673298aa299ac3bab346aaf16e` | 249 | 1,309,085 | 955 |

Selection excluded tests, fixtures, workflows, sensitive filenames, asset and
content directories. The audit read committed blobs, not uncommitted package
updates. Its result is explicitly inventory-only: no export, historical scan,
license clearance or semantic confidentiality approval. Pattern scanning alone
does not prove that code is safe to publish. Both original histories stay private.

Fresh read-only GitHub inspection separates site deployment from publishing:

| Component | Latest inspected run | Result |
| --- | --- | --- |
| Trebla website | 34065063732, September 6 | Hostinger deployment succeeded |
| Troco frontend | 34045538571, September 6 | Deployment succeeded |
| Kako website | 34065064548, September 6 | Deployment succeeded |
| Openings publisher | 34294030595, September 9 UTC | Failed at preserved intake error; media integration boundary remains |
| Troco publisher | 34290390212, September 8 | Failed at publication health, not Pages deployment |
| Trebla signal scout | 34278707896, September 8 | Succeeded; not proof of provider delivery |
| Kako curated publisher | 34168053935, September 7 | Cancelled; publisher workflow remains manually disabled |
| Equity | Workflow inventory | Zero registered GitHub Actions workflows |

No inspected run was retried. Successful old site deployments do not establish
completion of Cloudflare cutover, and cancelled/disabled work must not be called
a corrected publisher. Keep historical provider failures visible.

The active completion scope is items 1–24. OneSignal is deferred, not silently
counted as implemented and not a reason to stop the other migration work.

### Latest local safety and browser checks

Platform commit `b83a071` rechecks artifact retention eligibility atomically when
claiming cleanup. An intervening required or reconciling reference prevents
deletion. Missing or unexpected database change counts fail closed before R2;
skipped candidates advance pagination without counting as deletions. Twenty-two
real-SQLite regression cases cover the migration schema and race boundaries.
All 533 tests across 89 files, build, lint, typecheck and secret scanning passed;
specification and quality reviews found no blockers. This is local evidence,
not a production deployment. References acquired after the tombstone claim
still need the shared ownership protocol before media gateway activation.

Troco's canonical Pages site passed desktop (1280 px) and mobile (390 px)
browser checks across light, dark and system themes and Portuguese, English
and Spanish. No page error or horizontal overflow was observed. Its calculator
returned R$17.35 for R$100.00 received on an R$82.65 purchase, with matching
notes and coins. These checks did not submit a provider publication.

Fresh remote main revisions are Troco `0a4de3ae`, Trebla `57878c03` and Kako
`45934659`. The existing Pages candidates use these sources respectively with
Troco's isolated `27d739a` redirects, unchanged Trebla, and Kako's isolated
`d0b4e43` redirects. No newer remote main was omitted from those candidates.

DNS inventory remains blocked: the current Wrangler OAuth can enumerate the
Troco zone but its DNS-record read returns HTTP 403. No record was guessed or
changed. An interactive Cloudflare sign-in was requested while independent
implementation continues; DNS backup and rollback verification must precede
the remaining domain cutovers.

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

September 8 follow-up distinguished two Troco failure classes without reruns.
Run `34252257230` still reports one failed attempt at artifact finalization.
The repository artifact inventory returned all 52 records, with 64,297,647
non-expired bytes; this is not organization-wide billing/storage evidence.
Earlier run `34220037580` failed at `Fail on reconciliation error`, after the
reconciliation command returned `Provider execution ended in failed`, not
at the website deployment. Existing local historical records include
`buffer_async_failure`; they do not establish the affected remote provider's
underlying reason. Current remote `state/campaigns/2026-09-08.json` reports
Instagram, Facebook and YouTube as `published`, and TikTok as `skipped_disabled`.
This is persisted state, not a fresh provider/permalink verification. Do not
republish today's campaign merely because an overall workflow is red, and do
not hide historical delivery failures to manufacture a successful workflow.

Two bounded read-only Buffer queries subsequently verified the exact stored
provider identities. September 8 Instagram, Facebook and YouTube posts are
`sent` and each has an HTTPS external permalink. September 4 Facebook/YouTube,
September 5 Facebook/YouTube and September 6 Facebook remain `error` with no
permalink. Their provider error messages all identify inaccessible public media
URLs. This establishes a media availability failure, separate from GitHub's
artifact-finalization HTTP 403; it does not establish when or why the bytes
became unavailable. No post was created, edited or retried. The last response
reported 228 daily and 2,753 monthly API requests remaining. The diagnostic used
the documented `Post.error.message` field, excluded raw service errors and
redacted credentials/URLs from output. See the
[Buffer API reference](https://developers.buffer.com/reference.html).

Additional live Pages browser checks passed Trebla's theme toggle, projects,
blog index and article navigation; the article rendered 33 main paragraphs,
with no loaded broken images or horizontal overflow. Kako's character menu
opened, its Kako detail page rendered, and the games index linked to the
working Kako Aventureiro client. Starting, muting and pausing that game worked.
These are bounded interaction checks, not acceptance of every game, external
video service, device size or remaining legacy redirect.

A third bounded Buffer query retrieved only the failed posts' media locators.
Eight HEAD requests to the approved Troco GitHub Pages origin all returned 200
with JPEG/MP4 content types, without downloading bodies. Thus those files are
available now; the recorded provider failures refer to an earlier attempt.
The last API allowance was 227 daily / 2,752 monthly requests remaining. A
separate local reproduction confirms the current retention predicate can omit
a campaign still marked `scheduled` once it falls outside the rolling dates.
That unsafe case is being corrected on the isolated Troco branch; it is not
proof of the precise historical removal event.

Kako isolated commit `d70b60e` pins original private bootstrap repository ID
`1349928184` before release/asset access and refreshes the reviewed compiler
fingerprint. All 1,432 tests passed with no skips or failures, plus typecheck,
lint and 31 focused cases. Independent specification and quality reviews passed.
It was pushed only to `cloudflare-publishing-cutover`; no main merge, rename,
public exposure or workflow dispatch occurred.

The inactive durable media resolver and migration `0009_public_media_grants.sql`
now have 88 real-SQLite/resolver tests. Exact tenant/hash/delivery approval,
explicit enabled controls and live retention are required; no access writes,
provider calls or grant creation occur. Review found and fixed a mismatch
between SQLite Julian dates and JavaScript expiry parsing: normalization now
happens before row limiting, with exclusive-expiry regressions. Both reviews
passed; the final platform build and all 621 tests across 90 files passed.
The resolver is not wired into production. Bridge approval issuance, provider
ownership, account admission, post-claim cleanup races and Free CPU acceptance
still prevent activation; this is not completed Openings end-to-end migration.

Platform `1d55270` rejects invalid measurement/clock dates, non-finite freshness
windows and unsafe summed capacity values. Five regression cases previously
admitted uncertain usage; the final suite passes 628 tests, including future
measurement rejection. Lint, typecheck, secret scanning and independent review
passed. This strengthens local admission but does not establish the historical
CPU incident's cause or replace account-wide usage evidence.

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

## September 8 private history and static Pages follow-up

Trebla isolated branch `cloudflare-publishing-platform` contains `ccd90fb`,
which pins workflow private-state reads to original repository ID `1348881573`
as well as name and visibility. Its 59 targeted tests, lint and unchanged
publication boundary passed. Commit `0d644ad` adds a GET-only historical quota
bridge for replacement ID `1361346222`, with strict private-record identity,
freeze/drain declarations, UTC cutover month, evidence hash and bounded reads.
It removes credentials from the CLI environment before asynchronous work,
requires the record even in later months and never falls back to zero on error.
The final four changed suites passed 124 tests; lint, production compilation
and all three unchanged safety boundaries passed. The ordinary `tsx` CLI build
was sandbox-blocked by its IPC socket; executing the same entry through
`node --import tsx` and the compiler/alias stages succeeded. Full-project
typechecking has 169 existing diagnostics both before and after this change;
there are no new diagnostics. Independent specification and quality reviews
passed. Remote isolated branch was verified at `0d644ad`, with no repository rename, public exposure,
workflow activation or fabricated migration record.

Fresh Pages metadata and browser inspection distinguished preview deployment
URLs from canonical production deployments. Basic Trebla, Troco and Kako home
pages rendered. HTTP checks then exposed Apache-only redirect behavior absent
on Pages, so static redirect parity was implemented before further acceptance.

Troco commit `27d739a`, isolated branch `fix/pages-static-redirects`, preserves
four legacy blog redirects plus their nontrailing-slash variants. All 60 Node
tests, 45 Vitest tests, lint and the 53-route static build passed; independent
review verified the exact legacy destinations. A single direct static upload
created production deployment `caae1ef1-31e5-419e-976f-47ed5916dd68` at
<https://caae1ef1.troco-frontend-preview.pages.dev>. Metadata confirms the existing
project now has canonical production on Pages branch `main`. All eight live
301 responses and five home/destination 200 responses passed. Git main and
Hostinger were not changed; no custom domain was attached.

The already validated, unchanged Trebla site at `57878c03` was uploaded once to
<https://2fb09fa4.trebla-website-preview.pages.dev> using Pages branch `main`.
The static output had 101 files, largest 241,457 bytes, no Worker/Functions or
blocked credential/configuration paths. All ten exported index routes returned
200. Host-specific legacy redirects still require separate acceptance before
domain cutover; this upload does not prove that parity.

Kako commit `d0b4e43`, isolated branch `codex/cloudflare-lola-redirects`, preserves
both original Lola redirects and their optional slash forms. All 133 tests,
lint, build and 43-artifact verification passed; independent review passed.
A single static upload created production deployment
`786f0df2-2570-4595-8516-4918d67306f3` at
<https://786f0df2.turmadokako-website-preview.pages.dev>. Four live 301 redirects
matched the exact original external destinations without following them. All
33 exported index routes returned 200. Initial probes of three guessed category
paths returned 404; these paths are absent from the export, so acceptance was
rerun against the actual generated route inventory. Removed legacy paths still
return 404 on Pages instead of Apache's 410; that parity gap remains explicit
and no Worker was added to work around it.

Final read-only Pages metadata confirms canonical production for Trebla, Troco
and Kako on Pages branch `main`, with their original preview deployments retained.
The project names still end in `-preview`; the API environment is `production`.
This is parallel hosted production for validation, not a completed domain cutover.

These direct uploads ran no GitHub Actions, D1 operation or publisher Worker.
There was no plan upgrade, DNS change, social post or deletion of old hosting.
Troco and Kako source corrections were pushed only to their isolated branches,
whose push events do not match the main-only legacy deployment triggers.
The [CPU checkpoint](cpu_incident_checkpoint.md) records new version-level
metrics and explicitly retains the Worker rollout hold.

## Next executable work

### Definitive static Pages workflows prepared

The repeatable production configuration now exists on isolated branches:

| Site | Commit | Local validation | Static export |
| --- | --- | --- | --- |
| Trebla | `5ebf296` | 100 tests, lint, build | 101 files |
| Troco | `0eb5477` | 62 Node + 45 Vitest tests, lint, build | 375 files |
| Kako | `d0c4778` | 135 tests, lint, build and existing 43-artifact verifier | 916 files |

All three workflows are manual, main-only and skipped unless the repository
variable `CLOUDFLARE_PRODUCTION_ENABLED` is explicitly true. They deploy current
Git main to the already-existing Pages project's `main` production branch,
not a pinned preview source. Actions and Wrangler versions are pinned;
Cloudflare credentials exist only in the final step. Troco/Kako's package token
is limited to dependency installation. No workflow was dispatched or enabled.

The metadata-only guard rejects more than 20,000 files, individual files above
25 MiB, symlinks/special files, credential-like filenames and missing index.
It also rejects runtime paths in the export **and** Functions/Wrangler config
in the deployment working directory. Independent review caught the latter
Wrangler discovery behavior; new failing regressions preceded its correction.
See [Cloudflare Direct Upload limits](https://developers.cloudflare.com/pages/get-started/direct-upload/).

Independent reviews passed and root reran the focused guards. Hostinger and
preview workflows are unchanged. Declaring `cloudflare-production` does not
provision its protection rules: those rules, scoped credentials and private
package access must be verified before activation. These branches have not
been merged into the existing product mains and no DNS or hosting changed.

### Equity executor inventory correction

Read-only review at isolated revision `0c6c8f8` confirms an existing durable
native executor: file-backed SQLite state/leases, persisted transitions,
intent-before-upload, known YouTube ID reuse and an ambiguous-upload block.
Fifty targeted fixture tests passed without production state or provider access.
The supervised Studio scheduling boundary is documented in the product and is
not evidence of an absent runner. Earlier descriptions of a "missing durable
local executor" were inaccurate and have been corrected in producer adoption.
The actual migration gap is shared-package receipt reporting/coordination;
large video bytes and OAuth remain local. This review does not establish live
provider readiness or activate scheduling.

Equity commit `5aa3679` now adds a pure local receipt projection through the
existing `@trebla/publishing` 0.1.2 validator, on its isolated branch. It accepts
only consistent persisted verification/scheduling/publication evidence and
emits five allowlisted metadata fields. Private/scheduled videos have no public
URL. The receipt acceptance timestamp is explicitly the saved remote
verification time, not an invented upload timestamp. Full factory verification
passed 446 tests and typecheck; independent review and root's 65 focused tests
passed. No runtime caller, remote reporting, upload or ownership transfer was
activated by this change.

### Bounded public-history credential scan

Fresh public main refs were fetched read-only: Troco `ba9f21a` and Openings
`6923161`. Every reachable blob up to 5 MiB was checked using the platform's
known credential-format patterns, reporting only blob IDs/line numbers on
matches. Troco had 662 text and one binary blob; Openings had 1,175 text and two
binary blobs. No large blob was skipped and no pattern match was found. Current
isolated working sources also passed that scanner. Filename-history inspection
found only Troco's `.env.example` and no matching Openings environment/key file.

This is evidence for those patterns and refs, not a comprehensive secret or
privacy guarantee: arbitrary-format credentials, binary content, permissions,
public logs and unpublished editorial data require their separate checks.
The newer main commits are operational checkpoints; isolated migration changes
were not rebased over or substituted for them.

### Additional verified safeguards (September 8)

Troco publisher commit `79f74b3`, on isolated branch
`cloudflare-publishing-cutover`, retains media while a channel is scheduling,
scheduled or publishing, regardless of calendar age. The candidate Pages
payload is measured before replacing local output and rejected above the fixed
500,000,000-byte policy. Actual file bytes, generated metadata, symlinks and
copy-time changes are checked. Full check/validation passed: 192 tests and 19
tracked files across three provider contracts. Independent specification and
quality reviews passed. This branch was pushed without dispatching a workflow;
the change is not yet active on main and no historical post was retried.

The platform's temporary-upload intake now rechecks exact upload eligibility
inside the atomic artifact insertion. If cleanup has already claimed the
upload, its missing eligible locator fails the existing NOT NULL constraint
and rolls back the entire acceptance batch. The following claim UPDATE uses
the same predicate. Twenty-four real-SQLite regressions cover both cleanup
orderings, metadata/status rejection, multi-artifact rollback and compatibility.
Independent review passed; a fresh root run passed all 652 tests across 91
files, lint, typecheck and the secret scan. This requires no migration and has
not been deployed. It does not prove full artifact lifecycle safety or Free
CPU readiness.

The HTTP intake path also repeated the complete scheduled maintenance chain
after every accepted publication. A regression reproduced this extra work
through the default runtime, not a mocked maintenance implementation. Intake
now dispatches only the existing bounded outbox; scheduled events retain
capacity refresh, reconciliation, retries, upload cleanup and artifact cleanup
in their original order. Admission checks and atomic capacity accounting are
unchanged. Maintenance-dependent capacity recovery may wait for the next
scheduled run, conservatively. Independent review passed; full verification
passed 654 tests before two additional background-error cases, and the final
focused router suite passed 14 tests with lint/typecheck. Build and secret scan
also passed. This is not a measured CPU improvement or authorization to deploy.

### Local runtime replay and public snapshot safeguards

Commit `cb10d09` adds an opt-in real Wrangler local-runtime rehearsal using only
disposable local D1/R2 state, actual migrations and the shadow adapter. A signed
upload and intake produced one verified receipt. Restarting the Worker against
the same persisted state and replaying the envelope preserved exactly one
publication, delivery, receipt, attempt and upload. This proves Worker-restart
idempotency, not a fresh producer's media recovery or live provider ingestion.
Nineteen focused tests include interrupt cleanup of detached subprocess groups;
independent review approved the corrected cleanup behavior. No cloud resource or
production credential was used.

The new public snapshot inventory requires exact committed paths and SHA256
hashes. It does not copy files or approve disclosure. Private input directories,
existing workflows, symlinks, invalid text, known credential patterns and
oversized content are rejected. Git subprocesses cannot inherit repository
overrides or fetch promised objects; manifest reads are bounded and reject
non-regular files. Independent review and 31 focused tests passed. Final combined
platform verification passed 706 tests across 93 files, lint, typecheck and the
known credential-pattern scan. Public/private cutovers remain pending.

### Active-revision concurrency prerequisite

The media-binding investigation reproduced a race in the existing entity store:
two activations could both read the previous row, then write different hashes
under the same active revision. Real-SQLite tests loading the actual migrations
failed for both initially absent and existing entities. The corrected conditional
UPSERT evaluates revision/hash compatibility within the write and returns no
row on conflict, preserving the existing rejection error. It eliminates the
separate pre-write SELECT; no schema migration is required.

All 511 tests across 88 files, lint, typecheck and build passed. Independent
review found no blockers. Matching replay, distinct revisions and tenant
isolation remain covered. This guarantees only active-revision hash consistency,
not historical revision immutability or stale revision ordering. The immutable
media binding was subsequently implemented locally, as recorded below. No live D1 write, Worker deployment or
provider call was performed for this change.

### Troco existing-run diagnosis (September 9 UTC)

Read-only inspection of run `34252257230` confirmed that 6,360,508 archive bytes
uploaded successfully, but GitHub's artifact finalization returned an intermediary
403 before deployment. The log does not establish a quota or repository-permission
cause. No retry or permission expansion was made.

Later existing run `34290390212`, source `36140a39ba49afbe3a21de6bc65df232dd11a4f2`,
succeeded at preserving the archive, deploying Pages media, running the publishing
step and reconciling intents. It failed only at publication health: Facebook and
YouTube failures for the September 4, 5 and 6 campaigns remained unresolved.
Thus the latest red run is not evidence of a new deploy failure. These six
historical failures remain visible; no post was retried or marked healthy without
provider evidence. Success of a publishing step alone does not prove every post
was delivered. The archive incident's exact upstream cause remains unknown.

Credential inventory also confirmed owner-only mode 0600 for the four existing
project JSON backups, without printing values. Neither Trebla nor Kako's backup
contains `PUBLISHING_STATE_TOKEN`; the dedicated private-state credentials remain
a provisioning/backup gate, not a completed item.

### Immediate outbox work bound

Accepted HTTP intake now dispatches at most one due outbox row instead of up to
50. The limit is applied by the existing atomic SQL claim: a real-SQLite test
proved that the remaining eligible rows stay unclaimed and undispatched. The
scheduled maintenance path explicitly retains its existing 50-row bound; no
cron, admission, dependency or provider-ownership setting changed. Multi-delivery
publications may wait longer for scheduled draining. This is a work bound, not
a measured Free CPU guarantee.

Independent review approved the change. Full verification passed 707 tests across
93 files, lint, typecheck, build and the known credential-pattern scan. A fresh
actual local Worker upload/intake/shadow/restart/replay rehearsal also passed
with one publication, delivery, receipt, attempt and upload. No deploy occurred.

### Openings and Trebla existing-run diagnosis (September 9 UTC)

Openings run `34294030595`, source `6923161`, preserved intake with
`bridge_platform_media_pending`, `queueDepth: 28`, zero bridges and an incomplete
snapshot. The final failing step deliberately propagated that saved error.
This is the still-unimplemented media bridge boundary, not evidence that this
run exhausted CPU. No retired-origin dispatch or queue loss was introduced.

Trebla weekly run `34187245020` stopped at its zero-cost guard with
`MONTHLY_HEAVY_RUN_CAP_REACHED`, 16 heavy runs counted and zero remaining. Its
three later signal-scout runs succeeded, which does not imply a successful
weekly edition or provider delivery. The cap was not relaxed and no private
heavy workflow was rerun. Kako's recent non-migration publisher executions were
cancelled; the successful secret-transfer run is not delivery evidence.

### Kako private-state routing evidence

Commit `accf1c7` is pushed only to `cloudflare-publishing-cutover`. The resolver
checks immutable repository ID `1349928184`, private visibility and the exact
allowed current/future repository names before all six state checkouts. It uses
only the dedicated state token, with no broader-token fallback. Response reads
are bounded to 64 KiB and ten seconds; redirects are rejected. All 1,440 tests,
typechecking, lint and independent spec/quality reviews passed. This prepares
routing; it does not provision the token, complete editorial-input separation,
change visibility or reactivate publishing.

### Atomic capacity rejection and Openings binding evidence

Local commit `5021f47` preserves HTTP 429 retry-later semantics when the existing
account-global reservation trigger rejects intake after preflight. Eight tests
cover actual SQLite rollback and bounded error recognition. No accounting limit
was raised and no publication is accepted in the tested rejected transactions.

Local commit `9d1ace4` adds exact-revision Openings media manifests and migration
0010. Sixty-eight focused tests cover validation, atomic eligibility, contiguous
generations, exact replay and latest-only reads. New entity revisions do not
inherit old media. The store does not acquire retention, issue public grants,
approve providers or alter source entities. Each accepted generation adds one
manifest row and its primary-key index entry; exact replay adds no rows.
Eligibility changing between insertion and confirmation can return rejected
after insertion, so rejection must not be interpreted as proof of zero writes.

Combined verification passed 783 tests across 96 files, lint, typecheck, build
and the known credential-pattern scan; independent reviews approved both slices.
SQLite tests are not deployed D1 concurrency or CPU evidence. Neither migration
0010 nor these runtime changes have been deployed. The platform push remains
blocked pending the environment's requested explicit approval; local commits are
not evidence of remote availability. Grant issuance, native-provider ownership,
retention coordination, usage admission and activation remain pending.

### Upload cleanup confirmation

Local commit `c5ea29f` extends the existing artifact collector's fail-closed
claim acknowledgement to upload cleanup. Only exactly one changed row permits
R2 deletion; zero keeps its existing skip behavior. Six real-SQLite regressions
reproduced unsafe progress with absent/invalid metadata, then passed with the
guard. All 40 cleanup tests, scoped lint, typecheck and independent review
passed. Unconfirmed claims retain a retryable failed upload and its reservation,
without advancing the cursor. No eligibility or retention limit changed and no
remote object was deleted.

### Fresh producer recovery and streamed-upload correction

The new opt-in rehearsal uses actual package producers in separate processes,
not an in-memory manual replay. It found an integration failure: streamed upload
without Content-Length was rejected by local R2 as an unknown-length stream.
A separate disposable emulator reproduced the cause with identical bytes and
then accepted the explicit verified length. Package commit `4de5325` adds that
header after existing size/hash checks, without buffering or weaker validation.

Rehearsal commit `b88429a` subsequently passed against the actual local Worker:
lost acceptance preserved pending state; the original producer and Worker
stopped; the fixture media was deleted; a fresh producer recovered from saved
handoff after Worker restart. Recovery performed zero PUTs. Actual local D1 had
exactly one publication, delivery, receipt, attempt and upload, with the same
verified shadow receipt. This does not prove native provider ingestion, public
gateway behavior or production CPU compliance. Both independent reviews passed.

Version 0.1.3 is prepared locally for the upload fix, with internal workspace
pins aligned. The archive allowlist passed for all 67 files; the 24,663-byte
archive SHA-1 is `08b3fedd9ff0617c5df7d3e403c4fc310d249ca7`. A clean offline
installation and public exports passed under Node 20. It has not been published
to npm or adopted by product repositories; their released 0.1.2 remains intact.

Final verification passed 794 tests across 97 files, lint, typecheck and secret
scanning. The read-only npm authentication check returned E401; the browser
reported the Mac locked. Release is blocked on interactive authentication, in
addition to the outstanding environment approval for platform main push. No
credentials were created or exposed and no deploy was attempted.

### Public media runtime checkpoint — 2026-09-09

Commit `8e50b75` is pushed to platform main. The actual Worker router now
composes the existing finite admission, grant resolver and public media
transport. Native R2 range requests use `{ range }`; HEAD remains metadata-only.
Configuration is absent in Wrangler, so this new flow remains disabled. No
allocation, approval, provider activation, migration or deployment was performed.

The focused integration suite passes 98 tests against real SQLite and the
actual router. Root full validation passes 1,189 tests across 100 files, build,
lint, typecheck and known-secret scanning. Independent specification and quality
reviews approved the slice. This is local implementation evidence, not Free CPU
certification or completion of native-provider ownership.

A read-only Troco check found six historical Facebook/YouTube records from
September 4–6 still in Buffer error status with retained provider identifiers.
The latest inspected workflow failed its publication-health check on those
records. They were not reopened, cleared or resent. The September 9 Facebook
image and YouTube video returned successful media HEAD responses and their posts
were scheduled at inspection. Instagram's inspected scheduled media references
Buffer's own upload storage. This does not establish the historical failure
cause or successful delivery; recovery still needs provider-specific evidence.

Subsequent bounded read-only inspection of Buffer's `Post.error.message`
identified the same media-access failure for all six records. Each of their nine
referenced GitHub Pages media URLs now returns HEAD 200. This establishes current
reachability, not historical availability or successful provider ingestion.
No reschedule or duplicate create was sent. A dedicated Troco recovery branch is
preparing explicit same-ID reconciliation because the normal state machine
correctly keeps failed terminal and cannot currently observe later recovery.

### Remaining execution order (historical; later checkpoints supersede completed items)

1. Complete browser/integration and legacy HTTP behavior acceptance for the three canonical Pages candidates before attaching custom domains.
2. Complete the newer Trebla private-state token backup without revoking existing credentials; freeze/drain and reconcile actual historical usage before provisioning its cutover record.
3. Complete Kako's private/public state boundary and public-history audit before changing repository identities or visibility.
4. Complete the durable media gateway and Openings revision ownership locally, then obtain representative Free CPU evidence before runtime activation.
5. Diagnose the Troco artifact-finalization 403 from existing execution evidence before any bounded publication recovery.
6. Finish actual trigger ownership, Equity live provider validation and non-publishing end-to-end acceptance. OneSignal stays outside activation until its application is available.

See [producer adoption](producer_adoption.md) and [package release](package_release.md) for existing implementations that must be retained.
