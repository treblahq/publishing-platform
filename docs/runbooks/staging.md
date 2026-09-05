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
- `ONESIGNAL_REST_API_KEY`, the application API key for the Openings OneSignal
  app. It is installed as a Worker secret and must never appear in
  `ADAPTER_CONFIGS` or repository files.

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
deploys the Worker. Only `web.pages` is enabled. Its fixed target is:

`https://cloudflare-preview.openings-dev-web.pages.dev`

The existing Hostinger deployment and all production publisher workflows remain
unchanged. A failed staging run therefore has no production blast radius.

The staging Worker is available at
`https://publishing-platform-staging.business-850.workers.dev`. Every deployment
verifies `/health/live` externally and ends with one signed, sanitized,
Pages-only shadow publication that is inspected through the authenticated admin
API. The same check can be run independently through the manual `Smoke staging`
workflow. The OneSignal app and isolated `Publishing Platform Canary` segment
are configured. The adapter is compiled only for staging and every normal
deployment writes a fail-closed D1 control that pauses it before the Worker is
updated. Installing the secret and validating the public configuration cannot
send a notification.

The prepared `push.onesignal` configuration uses `audienceMode:
"staging-segment"` and the isolated segment. The deploy readiness check rejects
any other app, audience, segment, embedded key, or stale/free-tier-invalid usage
attestation. The adapter also rejects an absent segment instead of falling back
to `Subscribed Users`. `audienceMode: "production-broadcast"` is the only mode
that maps to every subscribed user, and it remains absent from staging.

`Canary OneSignal staging` is a separate manual workflow. It requires the exact
confirmation phrase, a job already visible on the Pages preview, and its title.
It resumes the adapter only around one unique publication, waits for both the
page and push receipts to become `verified`, and pauses the adapter in both the
script's `finally` block and an unconditional workflow cleanup step.

## Explicit remaining gates

Production stays disabled until all of these are recorded:

1. Shadow publication and injected failure cases pass in staging.
2. Worst-case measured usage stays below 40% of every internal budget.
3. OneSignal test-audience canary passes without broadcasting to subscribers.
4. DNS records are captured and compared immediately before cutover.

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
- the sanitized publication contains only the `web.pages` delivery; and
- the accepted publication is visible in the tenant-scoped ledger.

These checks now run after every staging deployment. The remaining external
gates are the OneSignal test-segment canary and the pre-cutover DNS comparison.
