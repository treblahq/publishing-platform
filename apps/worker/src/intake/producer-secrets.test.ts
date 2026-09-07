import { describe, expect, it } from 'vitest';
import { loadProducerSecrets } from './producer-secrets.js';

describe('isolated social producer credentials', () => {
  it('preserves existing pipeline credentials when adding the social client', () => {
    expect(loadProducerSecrets('{"pipeline":"existing"}', '{"social":"new"}'))
      .toEqual({ pipeline: 'existing', social: 'new' });
    expect(loadProducerSecrets('{"pipeline":"existing"}', undefined)).toEqual({ pipeline: 'existing' });
  });
  it('rejects overrides and malformed maps', () => {
    expect(() => loadProducerSecrets('{"pipeline":"existing"}', '{"pipeline":"new"}')).toThrow();
    expect(() => loadProducerSecrets('{"pipeline":"existing"}', '{"social":""}')).toThrow();
  });
});
