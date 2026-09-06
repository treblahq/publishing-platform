# Unified npm Package Design

## Decision

Expose one public package, `@trebla/publishing`, from the existing
`treblahq/publishing-platform` monorepo. It combines the provider-neutral
contracts and producer client that products always consume together.

Worker, CLI, adapter kit, provider adapters, and test helpers remain internal
workspaces with `private: true`. They may import the unified package but cannot
be published accidentally.

## Public API

`@trebla/publishing` exports the existing contract validators, types, signing,
outbox, upload, producer, and handoff APIs from one root entry point. Product
imports become:

```ts
import {
  stagePlatformHandoff,
  validatePublicationEnvelope,
  type PublicationEnvelope,
} from "@trebla/publishing";
```

The package supports Node.js 20 and newer, uses exact versions, contains no
secrets, and is published publicly under the free `@trebla` organization.

## Migration

The source from `packages/contracts` and `packages/client` is consolidated in
`packages/publishing`. Internal workspace imports and all five product adapters
move to the new package in the same migration. The two previous npm packages
remain immutable in the registry and receive a deprecation notice pointing to
the unified package.

No Cloudflare resource, deploy, DNS, OneSignal call, provider publication, or
GitHub Actions workflow is part of this migration.

## Safety and verification

- A release metadata test permits exactly one public workspace.
- Package contents are inspected before publication.
- The complete monorepo validation must pass.
- Each product must pass its existing validation after installing the exact
  unified version.
- Commits use `[skip ci]`; workflow history is checked after pushes.

