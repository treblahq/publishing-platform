# Local Runtime Rehearsal Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development and test-driven-development. Run only disposable local Wrangler state; no deployment or provider call.

**Goal:** Exercise real Worker routing, local D1/R2, queue delivery and restart recovery without a Cloudflare account operation.

**Architecture:** A separate opt-in tool generates a disposable config with only social.shadow enabled, fixture credentials and fake local binding identifiers. It applies actual migrations locally, seeds one fixture tenant/client and current capacity rows, starts the real Worker on loopback, uploads a tiny technical image and submits a signed publication. It verifies a persisted shadow receipt, removes only its generated producer fixture, restarts with the same disposable state, and replays the exact envelope without another upload. Existing production config and data are never used.

**Tech Stack:** Node 24, existing pinned Wrangler CLI, SDK signing helpers, actual Worker/D1/R2/Queue local runtime.

## Task 1: Fail-closed orchestration contracts

Create `tooling/rehearse-runtime.mjs` and `tooling/rehearse-runtime.test.mjs`.

- [ ] Export pure configuration/command builders for tests. Config must point to the existing Worker source and actual migrations, but declare new fixture-only database/bucket/queue names and dummy IDs. No production environments, crons or public adapters; `ENABLED_ADAPTERS` is exactly `social.shadow`, producer credentials are an explicit test-only constant, adapter configuration is empty.
- [ ] Tests assert all D1 commands contain `--local`, the generated config and disposable persistence path; forbid `--remote`, deploy, production environment selection, real credential inheritance and external target URLs. Runtime must bind only 127.0.0.1, use local mode, disable telemetry/update checks where supported, and run installed Wrangler rather than installing anything.
- [ ] Write tests before implementing those builders and confirm expected failures. Importing the module must not start processes or write files.

## Task 2: Real-runtime fixture and restart acceptance

- [ ] Allocate a fresh temporary directory and an available loopback port. Build a sanitized child environment with runtime-required OS paths only, no inherited Cloudflare/provider keys. Generate the config inside the temp directory and use `--persist-to` there for every invocation.
- [ ] Apply migrations and seed one fixture tenant/client with the SHA256 of the test-only signing secret and fresh zero capacity usage for all three resources. Do not alter capacity limits or bypass admission.
- [ ] Start real local Wrangler, bounded startup timeout, captured bounded log output and guaranteed child termination. Health readiness uses only loopback. No scheduled work or provider adapter is enabled.
- [ ] Upload a small fixture with exact bytes/checksum using SDK signed headers. Submit a deterministic valid social.shadow envelope and poll signed publication status with a finite attempt bound until an exact shadow receipt exists.
- [ ] Remove only the generated local producer fixture, stop and restart Wrangler against the same local state. Replay identical publication content with a new authentication nonce. Assert the same publication ID and same shadow receipt without another upload.
- [ ] Stop the server and inspect the local ledger: exactly one publication, delivery and receipt, with no duplicate provider attempt. Emit only a small result summary. Preserve the disposable directory on failure for diagnosis, without printing raw credentials or request bodies.
- [ ] Add an opt-in npm script; do not attach this integration run to remote CI or default test execution. Run focused contracts, complete local rehearsal, full existing tests, lint/typecheck/build/secret scan and independent review before a microcommit.

## Evidence limits

Passing is local integration evidence, not real-provider delivery, D1 account
capacity proof, production CPU compliance or authorization to activate adapters.
OneSignal, media gateway exposure and live credentials are outside this tool.
