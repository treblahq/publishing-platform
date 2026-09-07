# Publication media gateway

## Reason for the next migration stage

Openings entity pages are served through Cloudflare, but its social publisher
still dispatches the legacy Hostinger bridge workflow. Cached legacy images do
not prove availability at the new origin. The current platform shell does not
carry approved bridge-image identities, and temporary shadow artifacts become
deletable after comparison. Those objects cannot be repurposed as durable public
social media by merely exposing the bucket.

## Boundaries

Use the existing Worker, D1 and private R2 bucket. Do not enable public bucket
listing, create another bucket, use a paid image/video transformation service,
or add per-publication Pages builds. Render in the product-owned execution
environment. OneSignal remains excluded. Equity videos and OAuth remain local.

The common delivery engine must first recover durable asynchronous receipts and
release media only after the adapter confirms ingestion. Shadow acceptance does
not authorize real-provider media deletion.

## Public transport

A public media route resolves an opaque artifact ID and exact SHA-256 under a
tenant. It serves only approved PNG, JPEG and MP4 objects referenced by explicitly
enabled public-delivery adapters, with a live retention reference. It does not
expose arbitrary R2 keys, unclaimed uploads, local paths, web JSON, HTML, SVG or
Equity video assets. Missing, expired or released objects return 404; they must
never fall back to a client HTML shell.

Verify stored size, checksum metadata and MIME before streaming. Support bounded
single-range video reads, HEAD, content-type, nosniff and conservative caching.
Reject malformed paths and ranges. Public access is not permission to create,
extend or reset an artifact reference. Integrate account-wide free-usage guards
before enabling the route; traffic must not introduce an unmetered R2 path.

## Openings bridge binding

Keep the data pipeline as the only owner of the job entity. A separate immutable
bridge manifest binds the job's current content revision to approved media
hashes, logical roles and render versions. It may enrich that exact entity's
metadata but cannot replace its title, canonical URL, revision or source JSON.
An older bridge cannot reactivate over a newer approved bridge. New job revisions
must not inherit stale social media automatically.

Serve canonical job media URLs through this binding and verify exact image
hashes, image dimensions, video type and render versions before provider work.
Publishers must submit through this path instead of dispatching FTP. A missing
binding remains a retryable migration boundary, never a successful deployment.

## Retention and ownership

Every required provider retains its own reference until confirmed ingestion.
Bridge publication is not itself proof that providers have fetched the files.
Do not activate the bridge until native-provider receipts can either be reported
durably or those providers have transferred to the engine with exclusive owner
markers. Once all required consumers are safe, remove temporary bytes; retain
small metadata and receipts. Old job links continue to render entity text even
after optional social media is gone.

## Acceptance gates

- Unit and real-SQLite tests prove tenant isolation, approved revision binding,
  private/unclaimed/expired denial, stale-owner rejection and range behavior.
- Response loss, a fresh executor, processing delay and cleanup races do not
  duplicate posts or delete needed media.
- A local end-to-end rehearsal makes no external call and simulates both initial
  intake and restart after producer media deletion.
- One bounded real approved publication is verified with cache bypass, including
  its public media and provider receipts, within measured free allowances.
- No legacy dispatch fallback remains for cloud-owned work before retiring
  Hostinger. Gates and existing owner markers are changed as one reviewed cutover.

This document records the remaining design, not an implemented or activated
gateway. Existing technical shadow receipts do not satisfy these gates.
