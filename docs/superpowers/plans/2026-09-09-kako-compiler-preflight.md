# Kako Compiler Preflight Implementation Plan

> Execute inline with systematic debugging and test-driven development; preserve the approved Free-only, isolated-branch scope.

**Goal:** Reject a stale committed compiler identity before costly verification in Kako CI and manual dry runs.

**Architecture:** Reuse the existing independent implementation manifest collector and identity comparison in a read-only workflow step after npm installation, before `npm run verify`. Do not regenerate identity in CI, weaken the comparison, change publishing gates, or introduce dependencies. Increasing timeouts would not fix an identity mismatch; running the whole suite before discovering it wastes runner time.

**Tech stack:** Existing Node 24.14.1, TypeScript strip-types support, YAML workflow contracts, Node test runner.

## Bounded steps

- [x] Add a workflow contract in `test/workflows/ci-runtime.test.ts` for `.github/workflows/ci.yml` and `.github/workflows/publisher-dry-run.yml`. Parse YAML, locate `Verify compiler identity`, require it after `npm ci` and before `npm run verify`, forbid `continue-on-error` and conditional bypass. Verify the command invokes the existing collector and compares against the imported committed identity, with no file writes.
- [x] Run `node --test test/workflows/ci-runtime.test.ts` and confirm the missing-step assertion fails.
- [x] Insert the following identical run step in both workflows, after `npm ci`:

```yaml
      - name: Verify compiler identity
        run: |
          node --input-type=module <<'NODE'
          import assert from 'node:assert/strict';
          import { buildCompilerImplementationManifest, runtimeCompilerBuildId } from './scripts/prepare-zero-touch-supply.ts';
          import { RUNTIME_COMPILER_BUILD_ID } from './src/zero-touch/runtime-compiler-build.ts';
          assert.equal(runtimeCompilerBuildId(await buildCompilerImplementationManifest(process.cwd())), RUNTIME_COMPILER_BUILD_ID, 'Compiler identity is stale; review and regenerate it locally before verification.');
          NODE
```

- [x] Run workflow contracts and the sixteen existing compiler identity tests. Execute the actual YAML command locally to verify success. Its imported comparator is already covered for dependency-lock/source drift and rejection before attestation by the existing tests; do not claim the added workflow test independently covers every tampering case. All 38 workflow contracts passed; the actual command also rejected an injected stale constant with exit 1 and did not regenerate files.
- [x] Retain the full 1,440-test package validation, typecheck and lint results, then rerun the changed workflow contracts and typecheck/lint. Only workflow/test files change in this slice; compiler inventory and runtime bytes do not change. Commit only validated files to the existing isolated branch. No workflow dispatch or production merge. Package/identity commit: `d7c3cfc`; preflight commit: `8c7557c`. The 1,440-test count precedes the added workflow assertion; all 38 final workflow contracts passed separately, followed by fresh typecheck/lint.

This is an early consistency check, not proof of editorial approval, safe public visibility, Free runtime compliance or provider readiness. The existing full verifier still runs after a successful preflight.
