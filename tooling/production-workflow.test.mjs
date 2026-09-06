import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = '.github/workflows/deploy-production.yml';

describe('production deployment workflow', () => {
  it('is manual, protected, ordered, and read-dominant', () => {
    const workflow = readFileSync(path, 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+(push|schedule):/mu);
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain('timeout-minutes: 15');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm run validate');
    expect(workflow).toContain('hydrate-production-config.mjs');
    expect(workflow).toContain('production-readiness.mjs');
    expect(workflow).toContain('wrangler deploy --dry-run --env production');
    expect(workflow).toContain('wrangler deploy --env production');
    expect(workflow.indexOf('wrangler deploy --dry-run --env production'))
      .toBeLessThan(workflow.lastIndexOf('wrangler deploy --env production'));
    expect(workflow).toContain('/health/live');
    expect(workflow).not.toMatch(/backfill|onesignal|social\.|bootstrap-staging|dns|pages deploy/iu);
    expect(workflow).not.toContain('/v1/publications');
    expect(workflow).not.toMatch(/PRODUCER_SIGNING_SECRET|PRODUCER_SECRETS/u);
    expect(workflow).not.toMatch(/production candidate/iu);
  });

  it('leaves no staging workflow available to dispatch', () => {
    const workflows = readdirSync('.github/workflows');
    expect(workflows.some((name) => name.includes('staging'))).toBe(false);
  });

  it('pins third-party actions to immutable revisions', () => {
    const workflow = readFileSync(path, 'utf8');
    for (const line of workflow.split('\n').filter((value) => value.includes('uses:'))) {
      expect(line).toMatch(/uses:\s+[^@]+@[0-9a-f]{40}\s*$/u);
    }
  });
});
