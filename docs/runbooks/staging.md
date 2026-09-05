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
- `CLOUDFLARE_API_TOKEN`, scoped only to the staging Worker, D1, Queues and R2
- `PRODUCER_SIGNING_SECRET`, a random value of at least 24 characters
- `ADMIN_TOKEN`, a separate random value

The workflow derives the D1 credential hash and the Worker's JSON secret from
the same signing value, so they cannot drift. Raw secrets are never committed
or written to D1.

## Safe initial deployment

Run `Deploy staging`. It validates the repository, checks environment isolation,
installs secrets, applies migrations, bootstraps the Openings preview tenant and
deploys the Worker. Only `web.pages` is enabled. Its fixed target is:

`https://cloudflare-preview.openings-dev-web.pages.dev`

The existing Hostinger deployment and all production publisher workflows remain
unchanged. A failed staging run therefore has no production blast radius.

After deployment, verify `/health/live`, send one signed sanitized shadow
publication, and inspect it through the authenticated admin API. Do not enable
OneSignal until its separate test-audience canary is configured and verified.

## Explicit remaining gates

Production stays disabled until all of these are recorded:

1. Shadow publication and injected failure cases pass in staging.
2. Worst-case measured usage stays below 40% of every internal budget.
3. OneSignal test-audience canary passes without broadcasting to subscribers.
4. DNS records are captured and compared immediately before cutover.

There is no automatic paid-plan path and no production deploy in the staging
workflow.
