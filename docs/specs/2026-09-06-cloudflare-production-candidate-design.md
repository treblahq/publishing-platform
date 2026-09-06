# Cloudflare Production Candidate Design

## Objective

Build the final Cloudflare production environment while Hostinger remains the
active production host. Validate the complete Cloudflare path through its
`pages.dev` and `workers.dev` addresses, then make the eventual launch a DNS-only
cutover.

The migration must stay inside Cloudflare's free plan. It must not repeat the
Openings backfill, send social publications, send OneSignal notifications, alter
the current Hostinger deployment, or change public DNS during preparation.

## Chosen approach: promote data in place

The 1,320 Openings web entities already stored in the staging D1 database and R2
bucket become the initial production dataset. The production Worker binds to
those existing data resources, avoiding another backfill and its D1 write cost.

The production Worker receives its own production queues and dead-letter queue.
New traffic must never be consumed by staging and production simultaneously.
Before production ingestion is enabled, staging queue consumers and scheduled
triggers are retired or made inert. Pending staging work is drained and verified
first.

Physical D1 and R2 resource names may continue to contain `staging`; their
documented ownership changes to production-candidate. Renaming or copying them is
not required for correctness and is not worth another migration. Logical
configuration, secrets, Worker names, queues, dashboards, and runbooks use
production terminology.

## Environments during migration

### Current production

- Hostinger continues serving the public domains.
- Existing publisher workflows remain unchanged until each product is cut over.
- Hostinger remains available as the rollback target after DNS cutover.

### Cloudflare production candidate

- Worker: `publishing-platform-production`, reached through its `workers.dev`
  address until DNS cutover.
- Pages: each product's final Cloudflare project, reached through `pages.dev`
  until DNS cutover.
- Data: the existing populated D1 database and R2 bucket are reused.
- Messaging: dedicated production queue and DLQ.
- Enabled adapter: only `web.r2` during the preparation phase.
- Disabled adapters: every social network and `push.onesignal`.
- Canonical URLs: continue pointing at the final public product domains so the
  generated documents do not need a second content migration.

Staging becomes disposable after the production candidate passes parity. It is
not kept as a second continuously running environment because duplicate cron and
queue activity would waste the free allowance.

## Promotion sequence

1. Finish the current staging queue and reach 1,320/1,320 web parity.
2. Record aggregate D1 counts, R2 object presence, queue state, and free-plan
   usage as the promotion baseline.
3. Add production configuration that reuses the existing D1 and R2 identifiers,
   uses dedicated production queues, enables only `web.r2`, and points to the
   final Pages candidate.
4. Add a manual, fail-closed production-candidate deployment workflow. It must
   run local validation, validate credentials and resource bindings, perform a
   dry-run bundle, deploy once, check health, and run a read-dominant web canary.
5. Deploy through the production GitHub environment only after all preflight
   checks pass. No automatic deploy is permitted.
6. Verify all 1,320 Openings URLs through the Cloudflare production-candidate
   address in bounded batches. Validate status, title, canonical URL, and
   publication revision.
7. Disable staging scheduled triggers and queue consumption. Keep its deployment
   temporarily available only for diagnostics, with no producer configured to
   send it work.
8. Prepare equivalent production-candidate Pages deployments for Trebla, Troco,
   Turma do Kako, and Equity on their existing isolated branches. Product
   onboarding remains disabled until each product has its own parity evidence.
9. Capture the DNS baseline, lower TTL if needed, and write the cutover and
   rollback checklist. Do not execute it during this phase.

## Safety gates

- Every workflow is manual and uses concurrency control.
- Public configuration contains placeholders only; identifiers and credentials
  live in the protected GitHub production environment.
- A readiness check rejects different D1/R2 resources, enabled social or push
  adapters, unknown adapters, non-Cloudflare preview origins, and production
  queue names reused by staging.
- No backfill command exists in the production-candidate workflow.
- The deployment smoke is read-dominant and must stop before the free-plan safety
  ceiling. It does not create a publication merely to prove the Worker is live.
- The production candidate accepts no normal producers until parity completes.
- A failed check prevents deployment; a failed deployment is investigated before
  any retry.

## Data and request flow

For web delivery, a product sends a signed publication to the shared Worker. The
Worker records the immutable publication in D1, queues the web delivery, stores
the versioned entity JSON in R2, and records the active manifest. A Pages route
asks the Worker for the entity; the Worker reads its manifest, checks the R2
object through metadata only, injects exact metadata into the bounded Pages
shell, and returns the response.

Social adapters and OneSignal stay outside this flow until their separate
activation gates are approved. Their credentials may exist but are neither
bound nor enabled in the production candidate.

## Validation and acceptance

The Cloudflare production candidate is ready for DNS cutover only when:

- repository validation, secret scanning, type checking, linting, and all tests
  pass;
- one production-candidate deployment succeeds from a fully validated commit;
- health and capacity endpoints are healthy within the free allowance;
- Openings parity reports exactly 1,320 successes and zero failures;
- production queues have no unexpected backlog or dead letters;
- social and push adapters are demonstrably disabled;
- staging has no active producer, consumer, or scheduled writer;
- the five product deployment branches remain isolated from current production;
- DNS baseline, launch checks, monitoring, and rollback steps are documented.

Changing DNS and retiring Hostinger are explicitly separate, later operations.
Hostinger remains available during the observation window after cutover.
