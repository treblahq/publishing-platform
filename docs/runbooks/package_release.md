# Public package release

## Prepared 0.1.3 candidate (not published)

The streamed-upload length fix passed the real local fresh-producer recovery
rehearsal: deleted source media, zero recovery uploads and one durable publication
and receipt. Its locally packed archive contains 67 allowlisted files, 24,663
bytes, SHA-1 `08b3fedd9ff0617c5df7d3e403c4fc310d249ca7`. A clean offline install
and public exports passed with Node 20. Only local workspace pins are updated;
do not update product dependencies before registry publication and verification.
The existing authenticated release/approval gates still apply. No registry
publication or Worker deployment is represented by this candidate.

Final candidate verification passed 794 tests across 97 files, lint, typecheck
and the known credential-pattern scan. Independent metadata review confirmed
only the intended version/pin changes in the lockfile. On September 9 UTC,
the read-only npm identity check returned E401 and the UI reported the Mac
locked. Interactive authentication is required before release; no token or
passkey step was bypassed.

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

## Version 0.1.2 release record

Version 0.1.2 adds acceptance-first recovery: a fresh executor can recover an
existing publication without reading or uploading deleted media. The matching
Worker ownership/content checks have been deployed separately.

The final local archive contains 67 files and is 24,585 bytes, with SHA-1
`1e2c39f42a46b6e0e7e8dda878aba0cb8b13b5ac`. Its clean installation and exported
coordinator were verified under Node 20. Full platform validation now passes
361 tests, including a release guard that rejects internal consumers pinned to
a different public-package version.

Version 0.1.2 was published on 2026-09-07 after the owner completed npm's
separate security-key confirmation. The public registry checksum matches the
audited archive above. A clean registry installation under Node 20 verified
the `createPlatformPublisher` export. Product branches may adopt the exact
version and regenerate their lockfiles; each product still requires its full
local verification and a separate live-ownership rollout.
