# CPU Incident and Recovery Checkpoint

> Preserve completed work and resume with a bounded CPU investigation, not another migration or architecture rewrite.

## Rollout hold

Do not enable additional providers, run backfills, dispatch Actions, upgrade
Cloudflare, or redeploy merely to investigate this incident. Preserve the current
working production deployment and native publication owners. This is an
operational hold, not an automated kill switch or a claim that scheduled work
has been disabled. OneSignal remains excluded.

## Observed evidence

Dashboard observations on September 7, 2026, around 16:30 America/Sao_Paulo:

| Surface | Window | Observation |
| --- | --- | --- |
| Retired publishing-platform-staging | 7 days | Approximately 20.73k invocations and 3.78k errors; CPU-limit errors present |
| Retired publishing-platform-staging | 24 hours | Zero invocations; public URLs disabled |
| publishing-platform-production | 24 hours | Approximately 4.63k invocations and 128 CPU-limit errors |
| Production versions with errors | 24 hours | 49863959: 104; 31429fbe: 12; d4850667: 12 |
| Current production version 76c2fb69 | Last hour | 57 invocations, zero errors; CPU P90 approximately 12.49 ms |
| Openings Pages production | 24 hours | 14,820 successful invocations, zero errors |
| Account billable usage | Current displayed billing period | USD 0.00 |

These are historical snapshots, not continuous monitoring. The email's 1,000+
count has not been matched to its exact reporting window. Error-free low-volume
traffic is not proof of headroom. The precise failing route/event and code-level
hotspot remain unconfirmed; do not attribute the incident to a function without
a profile or correlated invocation evidence.

## What is already preserved

- Production Worker version 76c2fb69-22db-4f48-987b-037c7258b1e0, from 931f133.
- Shared package @trebla/publishing 0.1.2 already published and adopted.
- Durable ownership, idempotency, receipt recovery and adapter work remain reusable.
- Trebla main 65a2068 contains gated LinkedIn CLI and manual recovery; the new
  PUBLISHING_LINKEDIN_ENABLED variable was absent when checked, so it is off.
- Platform main contains queue batch size one (c5a98b1), not yet deployed.
  This bounds per-invocation message/subrequest multiplication, not a proven CPU fix.
- Latest local validation: platform 453 tests; Trebla 1,650 tests plus lint,
  build and three safety checks. These do not demonstrate Cloudflare CPU compliance.

See [producer adoption](producer_adoption.md) for other products and remaining
media/executor boundaries. Do not reimplement or republish these completed pieces.

## Next bounded investigation

1. Read existing metrics by deployed version and invocation type; correlate
   errors with HTTP, scheduled or queue work. Use existing data first. If logs
   were disabled, report that attribution gap instead of guessing.
2. Profile locally with the actual shell/payload sizes and existing Worker
   runtime, separately for web rendering, signed intake, scheduled work and
   queue delivery. Include cold/warm runs. Local elapsed time is not Cloudflare CPU.
3. The code currently buffers and rewrites HTML in web/routes.ts, and intake
   attaches outbox dispatch using waitUntil in index.ts. These are investigation
   candidates, not established causes. waitUntil is not evidence of a separate
   free CPU allowance.
4. Change only a measured hotspot. If necessary, prepare expensive outputs in
   the existing producer/build phase rather than computing them on each request.
   Preserve authentication, tenant isolation, approval binding and receipt checks.
5. Run targeted regressions, then one complete validation before considering one
   consolidated corrective deployment. Do not activate Buffer in that deployment.
6. Validate a bounded representative flow and its actual Cloudflare CPU results
   before lifting the hold. No synthetic public social post, broad backfill or
   load test. Record per-event evidence and allowance margin explicitly.

The [Workers limits documentation](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)
lists 10 ms for Free HTTP requests and Cron events, with limited tolerance for
occasional overruns. Daily D1/R2/request quotas are different constraints; waiting
for their reset does not fix an over-budget execution. Verify the applicable
queue-specific limit separately rather than extrapolating from HTTP or paid plans.

## September 8 version-level follow-up

A read-only GraphQL query covered September 1 at 21:01:28 UTC through
September 8 at 21:01:28 UTC, grouped by date, version and status. Its returned
production errors were the same 128 `exceededResources` events on September 7:
104 for `49863959`, 12 for `31429fbe` and 12 for `d4850667`.

Current version `76c2fb69` returned 497 successful invocations on September 7
and 604 on September 8, with no error-status group. Its daily CPU P99 values
were 26.803 ms and 27.749 ms respectively. API schema introspection explicitly
identifies CPU quantiles as microseconds; earlier raw values must be divided by
1,000 to express milliseconds. Do not average the daily quantiles or interpret
absence of errors as proof of Free headroom.

The dataset exposes version/status dimensions but no invocation-type or request
path dimension. The settings response omitted observability configuration.
These reads therefore do not attribute the hotspot to HTTP, Cron, queue work,
or a particular route. No Worker invocation, settings change, deployment or load
test was performed by this investigation. The rollout hold remains unchanged.

## Stop conditions

Stop before any paid service, uncertain provider side effect or unproven rollout.
If representative CPU cannot fit Free after a narrowly measured correction,
present the evidence and the smallest component-placement change. Do not discard
the shared package or claim the full migration is complete.
