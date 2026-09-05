import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('wrangler environment isolation', () => {
  it('declares distinct local, staging, and production resources', () => {
    const path = resolve('apps/worker/wrangler.json');
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(config).toHaveProperty('env.staging');
    expect(config).toHaveProperty('env.production');
    const serialized = JSON.stringify(config);
    expect(serialized).toContain('DELIVERY_DLQ');
    expect(serialized).toContain('ENABLED_ADAPTERS');
    expect(serialized).toContain('publishing-artifacts-local');
    expect(serialized).toContain('publishing-artifacts-staging');
    expect(serialized).toContain('publishing-artifacts-production');
    expect(serialized.match(/"ENABLED_ADAPTERS":""/gu)).toHaveLength(3);
    const freeBudgets = JSON.stringify({ d1Rows: 70000, queueOperations: 7000, r2Bytes: 7516192768 });
    expect(serialized.split(JSON.stringify(freeBudgets))).toHaveLength(4);
  });
});
