# Trebla exclusive publication ownership

> Define the durable handoff boundary before enabling shared LinkedIn delivery.

The existing Trebla publisher claims `publishing` in its private GitHub ledger
before calling a provider. The shared publisher must compete for that same
record, not an independent lock. Otherwise a scheduled legacy runner could send
the same approved item while Cloudflare is delivering it.

## Durable fence

Add an optional strict `platformOwner` field to the existing publication record.
Its version, adapter (`social.buffer`), approved request digest and deterministic
handoff key identify ownership. Absence retains native behavior and canonical
serialization. The first scope is LinkedIn only.

Claim ownership with the existing compare-and-swap operation, and only for a new
record or an `eligible`/`prepared` record with zero attempts. Bind channel,
publication key, story and content revision to the validated approved request.
An existing matching owner is an idempotent recovery; a changed request fails
closed. Never take over `publishing`, `uncertain`, `published`, a nonzero attempt
or another terminal/blocked state. Do not automatically erase ownership.

Native orchestration must check ownership before constructing or calling its
channel runtime, including reconciliation. A platform-owned record returns an
explicit blocked summary with no native provider call. Existing deployed
versions use a strict record schema and reject the additional field rather than
silently ignoring it. An older in-flight runner with a stale record loses the
same ledger compare-and-swap before its provider mutation.

The claim helper itself performs no intake, media upload, secret access or
provider action. It does not mark anything as published and is not wired to an
enabled production path until the remaining handoff is complete.

## Verification

Use tests for new claims, exact replay, changed request, wrong channel/key/story,
all prohibited native states, old record canonical compatibility, and both
interleavings of native publishing versus platform ownership. Native callbacks
must remain untouched for a platform-owned item. Run the full Trebla suite,
lint, build and publication safety checks before merging.

## Remaining activation boundary

Before setting any live gate, the CLI must durably save the exact platform
envelope with its immutable image references before intake, recover the same
envelope after an ambiguous acceptance, persist acceptance and verified receipts,
and never fall back to native publishing. The current shadow envelope has a
separate purpose and must not be reused under the same idempotency key for a
different live request. Approved copy and alt text cannot be silently shortened
to satisfy provider limits.

Media pinning and ownership are prerequisites, not a completed migration. The
production adapter must remain disabled until credentials, channel identity,
product handoff and free-tier runtime limits have all been verified.
