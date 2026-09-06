# Cloudflare production

This is the primary Cloudflare production environment. Until public DNS is
changed, Hostinger remains the active public host and rollback target.

## Promoted resources

Cloudflare production deliberately reuses the populated resources created
during staging:

- D1 physical name: `publishing-platform-staging`
- R2 bucket: `publishing-artifacts-staging`
- Worker: `publishing-platform-production`
- Queue: `publishing-delivery-production`
- DLQ: `publishing-delivery-dlq-production`
- Pages origin: `https://cloudflare-preview.openings-dev-web.pages.dev`
- Worker origin: `https://publishing-platform-production.business-850.workers.dev`

The staging names on D1 and R2 are historical physical names. Wrangler provides
no in-place rename for them, so they now identify production data and must not
be copied or backfilled again.
Production messaging remains separate so no message has two consumers.

## Protected GitHub environment

Create a protected environment named `production` containing:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`, using the promoted D1 UUID
- `ADMIN_TOKEN`

Never put values in repository files or logs. Do not configure
`PRODUCER_SIGNING_SECRET` or the Worker `PRODUCER_SECRETS` during pre-cutover
validation; intake must remain uncredentialed. A configured OneSignal secret is
not sufficient to enable push: `push.onesignal` must remain absent from both
`ENABLED_ADAPTERS` and `ADAPTER_CONFIGS`.

## Free-plan preflight

Before the one manual deployment:

1. Confirm the current staging queue has drained and its real Openings deliveries
   have no unexpected dead letters.
2. Confirm daily D1 reads and writes have reset and remain below the internal 40%
   safety gate.
3. Confirm production queues exist and the repository contains no deployable
   staging environment or workflow.
4. Run `npm run validate` with Node.js 24.
5. Run `node tooling/production-readiness.mjs` against the hydrated production
   file and then a Wrangler dry run.
6. Confirm the commit being deployed has no newer failed workflow requiring
   investigation.

If any check fails, do not dispatch or retry the deployment. Diagnose locally
first. Cloudflare resource creation and usage must remain within the free plan.

## Deployment

Manually dispatch `Deploy Cloudflare production` once. It installs only the admin Worker secret,
applies only already-versioned idempotent D1 migrations, deploys with
`--env production`, and performs a GET-only live check. It does not bootstrap,
backfill, submit a publication, deploy Pages, call OneSignal, publish to a social
network, or modify DNS.

Migration `0008_promote_incomplete_web_deliveries.sql` creates one deterministic
production outbox event for each unfinished `web.r2` delivery left behind by the
retired queue and moves only those deliveries back to `ready`. Historical outbox
records, verified deliveries, and every non-R2 adapter remain untouched. Before
deployment this recovery set contained 38 deliveries; processing must be allowed
to drain naturally through the production queue before parity verification.

After deployment, run `tooling/verify-production-candidate.mjs` with one already
verified entity. It makes three bounded GET requests: live health, authenticated
capacity, and the entity route. It requires exact title, canonical URL, and
revision metadata.

Then verify all 1,320 Openings entities through the production Worker in blocks
of at most 100. Stop on the first failure or before the free-plan safety gate.
Never run the historical backfill again.

## Staging retirement

There is no staging environment or staging workflow in the repository. The old
Cloudflare Worker may keep its diagnostic URL temporarily, but no producer may
submit work to it. Verify in the Cloudflare dashboard that it has no active
consumer or schedule. Removing the old Worker and old queues is a separate,
destructive cleanup after production parity succeeds.

On 2026-09-06, both staging queue consumers and all three staging cron triggers
were removed, and the staging `workers.dev` subdomain was disabled. The old
queues still report the preserved Worker bindings as producers, but they have
zero consumers and the Worker has no public URL or scheduled invocation. The
resources remain recoverable and must not receive new work.

## DNS cutover boundary

DNS is not part of production-candidate deployment. Cutover requires separate
approval and all of the following evidence:

- 1,320/1,320 Openings routes pass with zero failures;
- production queues and DLQ are clear;
- social and push adapters are disabled;
- Pages and Worker health are stable on Cloudflare-owned origins;
- current DNS records and TTL values are captured;
- launch monitoring and rollback ownership are agreed.

At cutover, change only the intended product records. Keep Hostinger deployed
during the observation window. Rollback restores the captured records; it does
not require a code revert or data migration. Hostinger may be retired only after
the observation window is explicitly accepted.
