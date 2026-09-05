import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validatePublicationEnvelope } from '@treblahq/publishing-contracts';
import { createR2CanaryEnvelope } from './r2-canary-staging.mjs';

describe('R2 staging canary', () => {
  it('contains exactly one required R2 delivery and no push', () => {
    const envelope = createR2CanaryEnvelope('gh_123', 'Platform Engineer', '42');
    expect(() => validatePublicationEnvelope(envelope)).not.toThrow();
    expect(envelope.deliveries.map((delivery) => delivery.adapter)).toEqual(['web.r2']);
  });

  it('builds the workspace client before executing the canary', () => {
    const workflow = readFileSync('.github/workflows/canary-r2-staging.yml', 'utf8');
    expect(workflow.indexOf('npm run build --workspace @treblahq/publishing-contracts'))
      .toBeLessThan(workflow.indexOf('node tooling/r2-canary-staging.mjs'));
  });
});
