import { describe, expect, it } from 'vitest';
import { validatePublicationEnvelope } from '@treblahq/publishing-contracts';
import { createR2CanaryEnvelope } from './r2-canary-staging.mjs';

describe('R2 staging canary', () => {
  it('contains exactly one required R2 delivery and no push', () => {
    const envelope = createR2CanaryEnvelope('gh_123', 'Platform Engineer', '42');
    expect(() => validatePublicationEnvelope(envelope)).not.toThrow();
    expect(envelope.deliveries.map((delivery) => delivery.adapter)).toEqual(['web.r2']);
  });
});
