# CPU Incident and Recovery Checkpoint

## September 9 streaming route comparison — local candidate

The candidate replaces the four whole-shell cleanup regex passes and buffered
text read with native HTMLRewriter. The previous profiler was reused with the
same cached jobs/authors/communities shells and old compiled route; the candidate
was freshly bundled. Both variants completed 31 requests per kind locally, with
expected selected-entity metadata. No Pages fetch, Cloudflare write or public
load test was performed; runtime outbound requests remained denied.

| Kind | Old local median elapsed ms | Candidate local median elapsed ms | Old cleanup regex leaf samples | Candidate cleanup regex leaf samples |
| --- | ---: | ---: | ---: | ---: |
| Jobs | 3.222 | 2.786 | 116 | 0 |
| Authors | 2.241 | 2.146 | 79 | 0 |
| Communities | 2.267 | 1.990 | 82 | 0 |

These are local elapsed times and sparse V8 samples, not Cloudflare billable
CPU or complete native-parser CPU measurements. The 4–14% median elapsed
improvement is a bounded observation, not a production performance guarantee.
The comparison does not cover deployed D1/R2, intake, queue or scheduled work.
The rollout hold remains. Independent specification/security reviews approved
the change, and full validation passed 1,204 tests across 100 files, build, lint,
types and secret scanning. The existing router integration assertion now runs
in native workerd instead of Node, retaining its exact shell-fetch and fake
Mastodon configuration checks. No production deployment occurred.

## September 9 local workerd route profile

The actual unchanged `handleWebEntityRequest` was bundled into local workerd
with in-memory manifest/object checks and the three real static Pages shells.
Exactly three bounded static GETs loaded the shells; runtime outbound calls were
denied. Separate instances handled one first and 30 warm requests for each kind,
and all 93 responses returned 200 with the expected entity metadata.

| Kind | Shell bytes | HTML-cleanup regex leaf samples | Handler leaf samples |
| --- | ---: | ---: | ---: |
| Jobs | 140,831 | 88 / 275 | 67 / 275 |
| Authors | 94,856 | 45 / 142 | 30 / 142 |
| Communities | 96,505 | 62 / 203 | 47 / 203 |

The four cleanup regexes account for roughly 30–32% of these sparse local
samples; no one regex consistently dominates. This identifies local work, not
the cause of the historical incident. Sample timing includes scheduling/idle
effects and is not per-request CPU. Mock response construction contributes too.
The full Worker, signed intake, D1/R2 and queue path are not covered by this
profile. Do not remove security/metadata safeguards or lift the rollout hold
based on these results.

Versions: Node 24.14.1, Wrangler 4.129.0, Miniflare 5.20260903.0-alpha,
workerd 1.20260903.1 and esbuild 0.25.12. The summary is backed up in the
owner-only external platform docs folder. No production deployment or resource
mutation occurred. The approach follows Cloudflare's
[local CPU profiling guidance](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

## September 9 UTC read-only follow-up

An additional instrumented copy of the existing local runtime rehearsal
captured the real user Worker through signed intake, artifact storage, outbox,
shadow queue delivery and fresh-process recovery after restart. The unchanged
fixture flow passed with one publication, delivery, receipt, attempt and upload;
recovery issued zero PUTs. The submit profile contained 84 samples and recovery
16. Observed application functions included nonce validation, intake, outbox,
queue consumption and artifact verification, alongside D1/native storage and
hashing calls. No dominant application hotspot was established at that sample
size. Separate Miniflare binding-service CPU, scheduled events and live
providers are not covered. This is not Free CPU certification.

The temporary harness retained isolated environment/configuration, the legacy
configuration refusal, dummy bindings, local-only commands, shadow adapter and
process-group cleanup. An initial inspector handshake failed before submitting
the fixture; exactly one fixture flow was executed successfully. All owned
processes were stopped. The runtime summary is backed up in the same external
owner-only docs folder; no repository runtime code or Cloudflare state changed.

At `2026-09-09T01:02:25Z`, the seven-day analytics query returned 1,218
successful invocations for current version `76c2fb69` (497 on September 7,
683 on September 8 and 38 on September 9), with no error-status group for
that version. Its daily P99 values were 26.803, 27.749 and 19.009 ms.
The 128 historical `exceededResources` events remained on older versions.
This is existing aggregated traffic, not a load test, event-level attribution
or sufficient Free CPU acceptance. Local changes after that version have not
been deployed. The rollout hold remains in place.

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
