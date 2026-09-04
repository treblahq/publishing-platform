import { describe, expect, it } from 'vitest';

import { validateWebEntityRevision } from './web-entity.js';

const validJob = {
  schemaVersion: 1,
  tenant: 'openings',
  kind: 'job',
  id: 'gh_123',
  revision: '2026-09-04T20:00:00Z',
  canonicalPath: '/jobs/gh_123',
  title: 'Senior TypeScript Engineer',
  summary: 'Build reliable publishing systems.',
  status: 'active',
  contentSha256: 'a'.repeat(64),
  content: { company: 'Trebla', applyUrl: 'https://example.com/apply' },
} as const;

describe('web entity revision', () => {
  it('accepts active and closed job revisions', () => {
    expect(validateWebEntityRevision(validJob)).toEqual(validJob);
    expect(validateWebEntityRevision({ ...validJob, status: 'closed' })).toMatchObject({
      status: 'closed',
    });
  });

  it.each([
    ['job', '/opportunities/gh_123'],
    ['author', '/users/alice'],
    ['community', '/community/acme/jobs'],
  ])('rejects a non-canonical %s route', (kind, canonicalPath) => {
    expect(() => validateWebEntityRevision({ ...validJob, kind, canonicalPath })).toThrow(
      'canonical path',
    );
  });

  it.each([
    ['unknown root field', { ...validJob, extra: true }],
    ['invalid hash', { ...validJob, contentSha256: 'abc' }],
    ['secret-like nested field', { ...validJob, content: { apiToken: 'secret' } }],
    ['empty identity', { ...validJob, id: '' }],
  ])('rejects %s', (_label, value) => {
    expect(() => validateWebEntityRevision(value)).toThrow();
  });

  it('rejects payloads larger than 256 KiB', () => {
    expect(() => validateWebEntityRevision({
      ...validJob,
      content: { description: 'x'.repeat(256 * 1024) },
    })).toThrow('too large');
  });
});
