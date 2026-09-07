# Kako Shadow Workflow Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Connect the existing private producer credentials to Kako's shadow bridge without enabling it or exposing credentials to preparation.

**Architecture:** Retain the existing private-state branch and the three native publication steps. Each step receives credentials only when the repository variable is exactly `true`; all other values normalize to disabled with empty credentials. Do not change triggers, native provider ownership, or remote configuration.

**Tech Stack:** Existing GitHub Actions YAML, Node 24, node:test, yaml.

## Task 1: Bind the existing three publication steps

Worktree: `/Users/guilherme/Workspace/Dev/repositories/.worktrees/kako-publishing-cutover`.

Files: `.github/workflows/activate-now.yml`, `.github/workflows/continuous-bootstrap.yml`, `.github/workflows/story-first-publisher.yml`, and `test/workflows/platform-shadow-persistence.test.ts`.

- [ ] Extend the existing workflow tests to parse YAML and find the single step whose run is `npm run publish:batch`. Require the four expressions below on that step, require one occurrence of each secret reference per workflow, and prove no other step has a platform credential. Replace the obsolete whole-file prohibition on the credential name with these scoped assertions. Preserve all existing private-state and default-off checks.
- [ ] Run `node --test test/workflows/platform-shadow-persistence.test.ts` with Node 24; verify three failures caused by absent bindings.
- [ ] Add only these entries to each identified step's existing `env` mapping:

```yaml
PUBLISHING_SHADOW_ENABLED: ${{ vars.PUBLISHING_SHADOW_ENABLED == 'true' && 'true' || 'false' }}
PUBLISHING_ENDPOINT: ${{ vars.PUBLISHING_SHADOW_ENABLED == 'true' && secrets.PUBLISHING_ENDPOINT || '' }}
PUBLISHING_CLIENT_ID: ${{ vars.PUBLISHING_SHADOW_ENABLED == 'true' && secrets.PUBLISHING_CLIENT_ID || '' }}
PUBLISHING_CLIENT_SECRET: ${{ vars.PUBLISHING_SHADOW_ENABLED == 'true' && secrets.PUBLISHING_CLIENT_SECRET || '' }}
```

- [ ] Run the focused tests, then `npm run verify`. Expected: all tests, types, lint and diff checks pass. No source or dependency edits are expected; if compiler inventory unexpectedly includes these workflow paths, stop and report before changing compiler metadata.
- [ ] Obtain spec and code review, commit only the four files with `[skip ci]`, and integrate as an ordinary fast-forward after checking remote main. Do not dispatch Actions, change repository variables, upload media, or call Cloudflare/provider APIs.

## Completion boundary

This task completes workflow wiring, not live provider migration. The existing shadow bridge is non-publishing and remains disabled remotely until a separate bounded rollout verifies durable restart behavior and free-tier capacity.
