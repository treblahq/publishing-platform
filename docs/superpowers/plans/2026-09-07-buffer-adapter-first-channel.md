# Buffer adapter: first live-channel implementation

> Execute with test-driven development and independent review. This advances
> the approved shared-Buffer phase; it does not activate any tenant by itself.

## Scope

Implement a private build-time `social.buffer` adapter in the existing Worker,
starting with LinkedIn `shareNow`, approved text and at most one PNG/JPEG image.
Reuse the current Buffer GraphQL API and existing product-owned public media.
Do not add another npm package, another service, a provider SDK, video uploads,
new Buffer channels, paid subscriptions, or changes to editorial approval.

Other Buffer channels and scheduling modes remain explicitly unsupported until
their existing product contracts are migrated and tested. Keep all live Buffer
gates disabled until tenant credentials and exclusive ownership are verified.

## Contract

- Fixed API origin `https://api.buffer.com`; reject redirects. Secrets come from
  a tenant-scoped Worker secret map, never public adapter configuration.
- Trusted config binds the channel ID, LinkedIn account URL and allowed public
  media repository/path. Producer options cannot override account identity.
- Payload carries exact approved text and artifact IDs; options carry the
  selected channel, `shareNow`, explicit AI-assistance flag and image alt text.
- Accept only `external` images under an approved `raw.githubusercontent.com`
  repository, pinned to a full Git commit SHA. Validate MIME, size and SHA-256
  with a bounded public read before provider mutation. Never forward the Buffer
  credential to media hosts. Reject missing, changed, oversized or redirected
  media before creating a post.
- Check the configured channel's ID, service, identity, connection/lock status
  and `manageUpdates` capability before creation.
- Perform at most one `createPost` mutation per delivery attempt. Buffer does
  not provide an established indefinite idempotency guarantee here. Ambiguous
  responses reconcile; they never authorize a blind repeat.
- Immediately return a sanitized receipt with the Buffer post ID and processing
  status. Do not wait in the Worker for asynchronous publication.
- Reconciliation with a durable receipt reads exactly that post and checks its
  channel and remote ID. Only `sent` is a verified publication. Scheduled/sending
  stays unresolved; error/deletion must not create a replacement post. Without a
  receipt, return unknown rather than claim a bounded search proves absence.
- Retention is safe only after confirmed ingestion. The initial channel uses
  existing external media, so it does not allocate R2 storage.

## Verification

1. Add failing tests for channel mismatch, secret placement, malformed options,
   mutable/unowned URL, hash/size mismatch, initial acceptance, transport loss,
   malformed mutation response, delayed publication and receipt mismatch.
2. Implement the adapter and configuration secret binding without activation.
3. Exercise the real consumer/store/reconciler with an in-memory provider and
   SQLite: one effect, saved processing ID, fresh load, verified receipt.
4. Run full validation and independent review before microcommits or deployment.
5. Before real cutover, add product-specific durable owner markers, immutable
   approved media URLs, receipt persistence and no-legacy-fallback behavior.
6. Verify current free allowances and transfer only the required tenant secret
   through an approved secure mechanism. Do not create a public test post or
   dispatch an extra publisher workflow merely to prove authentication.

References: [Buffer post scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html),
[Buffer GraphQL reference](https://developers.buffer.com/reference.html), and
the existing Trebla `buffer-linkedin.ts` adapter. The latter remains the live
owner until the final coordinated cutover.
