import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createStagingBootstrapSql } from './bootstrap-staging.mjs';

describe('staging D1 bootstrap', () => {
  it('seeds a scoped producer and fresh fail-closed capacity measurements without exposing the secret', () => {
    const secret = 'private-signing-secret-value';
    const sql = createStagingBootstrapSql('openings-preview', secret, new Date('2026-09-04T15:00:00.000Z'));
    expect(sql).not.toContain(secret);
    expect(sql).toContain(createHash('sha256').update(secret).digest('hex'));
    expect(sql).toContain("'openings-preview'");
    expect(sql.match(/INSERT INTO capacity_usage/gu)).toHaveLength(3);
    expect(sql).toContain('BEGIN IMMEDIATE');
    expect(sql).toContain('COMMIT');
  });

  it('rejects unsafe identifiers and weak secrets', () => {
    expect(() => createStagingBootstrapSql("bad'id", 'long-enough-secret-value')).toThrow('identifier');
    expect(() => createStagingBootstrapSql('openings-preview', 'short')).toThrow('at least');
  });
});
