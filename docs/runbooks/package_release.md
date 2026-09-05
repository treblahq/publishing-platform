# Public package release

The producer-facing packages are public, free npm packages. Only these two
workspaces are release targets:

- `@treblahq/publishing-contracts`
- `@treblahq/publishing-client`

All provider adapters, the Worker and the administrative CLI remain private
workspace packages. A release must never include credentials, local outboxes,
generated media or provider responses.

## Offline release check

Use Node 24 in this repository, then run the complete validation and create
the two package archives locally:

```sh
npm run validate
npm pack --workspace @treblahq/publishing-contracts --pack-destination /tmp
npm pack --workspace @treblahq/publishing-client --pack-destination /tmp
```

Inspect the archive listing before publication. It must contain only the
package README, MIT license, `package.json`, and production files under
`dist/`. Compiled tests are explicitly excluded. Install both archives in a
new temporary project using Node 20 as the compatibility smoke test.

## First public release

The first release requires an npm account that is allowed to publish the
public `@treblahq` scope. Authentication is an explicit external prerequisite;
never place an npm token in Git, a handoff JSON file or a shell history entry.

Publish contracts first because the client pins their exact version:

```sh
npm publish --workspace @treblahq/publishing-contracts --access public
npm publish --workspace @treblahq/publishing-client --access public
```

Then verify both immutable versions through the public registry before adding
the exact dependency to a producer repository. Do not use `latest`, a Git
branch, a local path, a floating range or an unpublished version in any
product lockfile.

## Product adoption gate

Each product branch may add `@treblahq/publishing-client` only after version
`0.1.0` is visible in the public registry and installs into a clean directory.
Regenerate and commit that product's lockfile, run its full local verification,
and confirm the branch starts no GitHub Action. Cloudflare credentials are not
needed for package installation or local outbox staging.

Publishing a later version follows the same dependency order and requires a
new immutable version. npm package versions are never overwritten.
