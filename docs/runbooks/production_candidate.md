# Cloudflare production candidate

This environment is the final Cloudflare production stack before public DNS is
changed. Hostinger remains the active public production and rollback target.

## Promoted resources

The production candidate deliberately reuses the populated resources created
during staging:

- D1 physical name: `publishing-platform-staging`
- R2 bucket: `publishing-artifacts-staging`
- Worker: `publishing-platform-production`
- Queue: `publishing-delivery-production`
- DLQ: `publishing-delivery-dlq-production`
- Pages origin: `https://cloudflare-preview.openings-dev-web.pages.dev`
- Worker origin: `https://publishing-platform-production.business-850.workers.dev`

The staging names on D1 and R2 are historical physical names. They now identify
promoted production-candidate data and must not be copied or backfilled again.
Production messaging remains separate so no message has two consumers.

## Protected GitHub environment

Create a protected environment named `production` containing:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`, using the promoted D1 UUID
- `PRODUCER_SIGNING_SECRET`
- `ADMIN_TOKEN`

Never put values in repository files or logs. A configured OneSignal secret is
not sufficient to enable push: `push.onesignal` must remain absent from both
`ENABLED_ADAPTERS` and `ADAPTER_CONFIGS`.

## Free-plan preflight

Before the one manual deployment:

1. Confirm the current staging queue has drained and its real Openings deliveries
   have no unexpected dead letters.
2. Confirm daily D1 reads and writes have reset and remain below the internal 40%
   safety gate.
3. Confirm production queues exist and staging has no consumers or scheduled
   triggers in the hydrated configuration.
4. Run `npm run validate` with Node.js 24.
5. Run `node tooling/production-readiness.mjs` against the hydrated production
   file and then a Wrangler dry run.
6. Confirm the commit being deployed has no newer failed workflow requiring
   investigation.

If any check fails, do not dispatch or retry the deployment. Diagnose locally
first. Cloudflare resource creation and usage must remain within the free plan.

## Deployment

Manually dispatch `Deploy production candidate` once. It installs Worker secrets,
applies only already-versioned idempotent D1 migrations, deploys with
`--env production`, and performs a GET-only live check. It does not bootstrap,
backfill, submit a publication, deploy Pages, call OneSignal, publish to a social
network, or modify DNS.

After deployment, run `tooling/verify-production-candidate.mjs` with one already
verified entity. It makes three bounded GET requests: live health, authenticated
capacity, and the entity route. It requires exact title, canonical URL, and
revision metadata.

Then verify all 1,320 Openings entities through the production Worker in blocks
of at most 100. Stop on the first failure or before the free-plan safety gate.
Never run the historical backfill again.

## Staging retirement

Staging keeps its diagnostic URL temporarily but has no queue consumers and no
scheduled triggers. No producer may submit new work to it. After production
parity succeeds, verify in the Cloudflare dashboard that staging has no active
consumer or schedule before treating it as retired.

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
