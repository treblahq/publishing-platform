import { describe, expect, it } from 'vitest';

import { validateArtifactReference } from './artifact.js';

const validArtifact = {
  id: 'job-card',
  storage: 'r2-temporary',
  sha256: 'a'.repeat(64),
  byteSize: 1024,
  mediaType: 'image/png',
  locator: 'staged/openings/job-card',
} as const;

describe('artifact references', () => {
  it('accepts immutable metadata without binary content', () => {
    expect(validateArtifactReference(validArtifact)).toEqual(validArtifact);
  });

  it.each([
    ['invalid storage', { ...validArtifact, storage: 'archive' }],
    ['invalid sha256', { ...validArtifact, sha256: 'abc' }],
    ['empty object', { ...validArtifact, byteSize: 0 }],
    ['binary content', { ...validArtifact, bytes: 'base64-data' }],
  ])('rejects %s', (_label, artifact) => {
    expect(() => validateArtifactReference(artifact)).toThrow();
  });
});
