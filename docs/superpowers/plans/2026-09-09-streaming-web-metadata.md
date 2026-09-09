# Streaming web metadata optimization

Goal: remove the measured repeated whole-shell JavaScript cleanup passes from
the actual web entity route without weakening metadata isolation or changing
manifest/object eligibility. This is a local corrective experiment under the
existing CPU incident plan, not approval to deploy or enable providers.

The local profile attributed roughly 30–32% of sparse handler samples to four
cleanup regular expressions. That does not establish historical incident cause.
Use native HTMLRewriter to transform the response stream instead of reading the
entire shell as text and running repeated replacements. An alternative prepared
shell build would change producer/deployment contracts; regex micro-tuning leaves
multiple full-body scans. Native streaming is the smaller runtime-only change.

## Invariants

- Preserve existing manifest lookup, object existence check, 404/503 behavior,
  canonical URL escaping, revision JSON escaping, noindex and cache headers.
- Remove shell canonical links, OG/Twitter metadata, description and JSON-LD;
  emit only the selected entity metadata and one publishing-entity JSON marker.
- Preserve unrelated scripts, body content and application bootstrap bytes.
- Never buffer the whole shell with text()/arrayBuffer() in the production route.
- Never add D1/R2 calls, fetches, caches, credentials or runtime flags.
- Consume native HTMLRewriter through real local workerd tests, not a regex mock
  or JS polyfill that masks native differences. Do not change request routing.

## Verification sequence

- [x] Add a real Miniflare/workerd harness bundling the actual route in memory.
  Reuse installed runtime dependencies, deny outbound network and dispose owned
  instances. Migrate the four existing tests without dropping their assertions.
- [x] Add RED for a shell whose text() throws: streaming must succeed without
  buffering. Cover escaped hostile title/summary/revision, chunk boundaries,
  stale structured/social metadata, multiple stale metadata tags, absent
  optional summary, all three entity kinds, 404 before shell fetch and 503 shell.
- [x] Implement native transformation, retaining unrelated application scripts
  and avoiding duplicate generated metadata. Prove the test was behavior RED.
- [x] Run native focused tests, build/typecheck/lint and independent reviews.
- [x] Root full validation and bounded local profile comparison with the same
  real shells. No claim of production Free CPU compliance from local timings.
- [ ] Commit reviewed code with skip-CI. Production rollout hold stays in force.

Scope: apps/worker/src/web/routes.ts and its tests; a test-only local native
harness if needed. No adapter, intake, queue, binding or deployment edits.
Reference: https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/

Evidence: 19 native route tests plus 15 router tests pass; root full validation
passes all 1,204 tests across 100 files, build, lint, types and secret scan.
The existing web/Mastodon router test was migrated to native workerd, preserving
all assertions, because Node alone lacks HTMLRewriter. No production index or
compatibility flag changed. Both independent reviews approved the final tests.
Local profiles used the same three cached shells and 93 requests per variant;
cleanup regex samples disappeared and median elapsed times improved 4–14%.
These observations do not certify Cloudflare CPU or lift the rollout hold.
