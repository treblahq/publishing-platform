# Staging rollout

Staging is isolated from production and is deployed only by manually running
the `Deploy staging` GitHub workflow. The workflow cannot deploy while the D1
identifier is a placeholder, production adapters are enabled, or staging is
configured to call anything other than the read-only Pages verifier.

## One-time Cloudflare setup

Create free-plan resources in the Trebla Cloudflare account using the exact
staging names already present in `apps/worker/wrangler.json`:

- D1: `publishing-platform-staging`
- Queue: `publishing-delivery-staging`
- DLQ: `publishing-delivery-dlq-staging`
- R2: `publishing-artifacts-staging`

Replace only the staging D1 placeholder with its real UUID. Leave production
placeholders and production adapters untouched.

Create a protected GitHub environment named `staging` with these secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`, a user API token (`cfut_`) scoped only to the staging
  Worker, D1, Queues and R2. Account-owned tokens (`cfat_`) are rejected by the
  workflow preflight because Wrangler cannot use them for this deployment path.
- `PRODUCER_SIGNING_SECRET`, a random value of at least 24 characters
- `ADMIN_TOKEN`, a separate random value

The workflow derives the D1 credential hash and the Worker's JSON secret from
the same signing value, so they cannot drift. Raw secrets are never committed
or written to D1.

Before installing dependencies, the workflow checks every required secret and
identifier structurally. It never prints their values. This makes a missing,
placeholder, or incompatible credential fail in seconds instead of spending the
rest of the validation and deployment minutes.

## Free-only capacity policy

The platform has no automatic upgrade or paid fallback. New work fails closed
when usage cannot be measured recently, and two independent guards reject work
before the configured ceiling: the Worker admission check and an atomic D1
reservation trigger.

The current effective rejection points are deliberately below half of each
published free allowance:

| Resource | Free allowance encoded in the ledger | Reject new work at |
| --- | ---: | ---: |
| D1 writes | 100,000/day | 49,000/day |
| Queue operations | 10,000/day | 4,900/day |
| R2 storage | 10 GiB | 4.9 GiB |

The extra margin covers retries, maintenance, measurement lag, and activity
outside an accepted publication. Temporary R2 artifacts are deleted after all
references become safe to delete; abandoned staging uploads expire after 24
hours, and terminal failures are collected after seven days. R2 objects are not
kept as a permanent archive after successful publication.

## Safe initial deployment

Only after local validation is green, manually run `Deploy staging`. It checks
credentials first, validates the repository, checks environment isolation,
installs secrets, applies migrations, bootstraps the Openings preview tenant and
deploys the Worker. Only `web.r2` is enabled. Its fixed public target is:

`https://cloudflare-preview.openings-dev-web.pages.dev`

The existing Hostinger deployment and all production publisher workflows remain
unchanged. A failed staging run therefore has no production blast radius.

The staging Worker is available at
`https://publishing-platform-staging.business-850.workers.dev`. Every deployment
verifies `/health/live` externally and ends with one signed, sanitized,
web-only shadow publication that is inspected through the authenticated admin
API. The same check can be run independently through the manual `Smoke staging`
workflow.

Mobile push is deliberately deferred until the Openings app is available for
end-to-end testing. `push.onesignal` is absent from the deployed adapter registry
and staging configuration, and the normal deploy does not require or install a
OneSignal credential. Re-enable it only through a separately reviewed change and
the isolated canary workflow; never use a broadcast audience for that test.

## Bounded Openings entity backfill

The manual `Backfill Openings web staging` workflow publishes one R2 entity per
job, author and community from the `cloudflare-preview` data snapshot. Before
submitting anything it validates the producer and asks the live admin API for
current usage. It refuses the entire run when the existing usage plus the full
worst-case batch would reach 40% of any free allowance.

The backfill is idempotent. A partial run may be repeated only in a later safe
capacity window; existing publication keys do not create a second entity. The
outbox claims rows atomically before sending them to Queue, so concurrent intake
requests cannot waste Queue operations by dispatching the same row.

After the outbox drains, run `npm run verify:publishing-web-parity` in the
Openings data pipeline. The verifier checks every expected job, author and
community route for the exact title, canonical URL and publishing revision. A
generic Pages fallback with HTTP 200 is treated as a failure.

## Explicit remaining gates

Production stays disabled until all of these are recorded:

1. Shadow publication and injected failure cases pass in staging.
2. Worst-case measured usage stays below 40% of every internal budget.
3. Every expected web entity passes the live parity verifier.
4. OneSignal test-audience canary passes after mobile testing resumes, without
   broadcasting to subscribers.
5. DNS records are captured and compared immediately before cutover.

There is no automatic paid-plan path and no production deploy in the staging
workflow.

## Recorded staging validation

On 2026-09-05, `Deploy staging` run `33979210075` completed every deployment
step and published Worker version `6ec2f039-2acb-4d9f-bebc-c11e02a705df`.
The final smoke check recorded publication
`e5890927-98a1-47ce-8d6e-da83df2f2054` after verifying all of the following:

- unauthenticated intake is rejected;
- an authenticated but invalid envelope is rejected without creating work;
- invalid admin authentication is rejected;
- account-wide projected D1, Queue and R2 usage is below 40% of each free
  allowance;
- the sanitized publication contains only a web delivery; and
- the accepted publication is visible in the tenant-scoped ledger.

These checks now run after every staging deployment. A later deployment run,
`33984918252`, applied atomic outbox claims and passed the full workflow. The
remaining external gates are complete entity parity, the deferred OneSignal
test-segment canary, and the pre-cutover DNS comparison.
