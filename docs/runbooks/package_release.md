# Public package release

The producer-facing API is one public, free npm package. It is the only
release target:

- `@trebla/publishing`

All provider adapters, the Worker and the administrative CLI remain private
workspace packages. A release must never include credentials, local outboxes,
generated media or provider responses.

## Offline release check

Use Node 24 in this repository, then run the complete validation and create
the package archive locally:

```sh
npm run validate
npm pack --workspace @trebla/publishing --pack-destination /tmp
```

Inspect the archive listing before publication. It must contain only the
package README, MIT license, `package.json`, and production files under
`dist/`. Compiled tests are explicitly excluded. Install the archive in a
new temporary project using Node 20 as the compatibility smoke test.

## First public release

The first release requires an npm account that is allowed to publish the
public `@trebla` scope. Authentication is an explicit external prerequisite;
never place an npm token in Git, a handoff JSON file or a shell history entry.

```sh
npm publish --workspace @trebla/publishing --access public
```

Then verify the immutable version through the public registry before adding
the exact dependency to a producer repository. Do not use `latest`, a Git
branch, a local path, a floating range or an unpublished version in any
product lockfile.

## Product adoption gate

Each product branch may update `@trebla/publishing` only after the target version
is visible in the public registry and installs into a clean directory.
Regenerate and commit that product's lockfile, run its full local verification,
and confirm the branch starts no GitHub Action. Cloudflare credentials are not
needed for package installation or local outbox staging.

Publishing a later version requires a new immutable version. npm package
versions are never overwritten.

## Version 0.1.1 release record

Version 0.1.1 adds the durable single-handoff coordinator and was published on
2026-09-07 after authenticated login and a separate publishing passkey approval.
The registry exposes version 0.1.1 with SHA-1
`6e336b71a20f62697a1c75be4d37778741b87732`, matching the audited 67-file,
24,174-byte archive. Full platform validation passed 348 tests, and a clean
registry installation verified the coordinator export under Node 20.

Product integration branches may now adopt this exact version. Installing the
package alone does not transfer live provider ownership or complete a product's
Cloudflare migration; the local verification and rollout gates still apply.

## Version 0.1.2 release candidate

Version 0.1.2 adds acceptance-first recovery: a fresh executor can recover an
existing publication without reading or uploading deleted media. The matching
Worker ownership/content checks have been deployed separately.

The final local archive contains 67 files and is 24,585 bytes, with SHA-1
`1e2c39f42a46b6e0e7e8dda878aba0cb8b13b5ac`. Its clean installation and exported
coordinator were verified under Node 20. Full platform validation now passes
361 tests, including a release guard that rejects internal consumers pinned to
a different public-package version.

This version is **not yet published**. The authenticated npm account requested
a separate publication confirmation, and the Mac was locked when opening the
authenticated browser was attempted. Do not treat the prepared archive or
local temporary installations as registry availability. Complete authentication,
publish the audited archive once, verify its registry checksum, and only then
update each product's exact dependency and lockfile.
