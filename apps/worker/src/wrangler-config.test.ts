import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('wrangler environment isolation', () => {
  it('promotes stored web data while isolating production messaging', () => {
    const path = resolve('apps/worker/wrangler.json');
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(config).toHaveProperty('env.staging');
    expect(config).toHaveProperty('env.production');
    const serialized = JSON.stringify(config);
    expect(serialized).toContain('DELIVERY_DLQ');
    expect(config).toHaveProperty('queues.consumers.1.queue', 'publishing-delivery-dlq-local');
    expect(config).not.toHaveProperty('env.staging.queues.consumers');
    expect(config).toHaveProperty('env.staging.triggers.crons', []);
    expect(config).toHaveProperty('env.production.queues.consumers.1.queue', 'publishing-delivery-dlq-production');
    expect(config).toHaveProperty('env.production.d1_databases.0.database_name', 'publishing-platform-staging');
    expect(serialized).toContain('ENABLED_ADAPTERS');
    expect(serialized).toContain('publishing-artifacts-local');
    expect(serialized).toContain('publishing-artifacts-staging');
    expect(config).toHaveProperty('env.production.r2_buckets.0.bucket_name', 'publishing-artifacts-staging');
    expect(config).toHaveProperty('vars.ENABLED_ADAPTERS', '');
    expect(config).toHaveProperty('env.staging.vars.ENABLED_ADAPTERS', 'web.r2');
    expect(config).toHaveProperty('env.production.vars.ENABLED_ADAPTERS', 'web.r2');
    expect(config).toHaveProperty('env.staging.vars.ADAPTER_CONFIGS');
    expect(config).toHaveProperty('env.production.vars.ADAPTER_CONFIGS');
    expect(serialized).toContain('https://cloudflare-preview.openings-dev-web.pages.dev');
    const freeBudgets = JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 });
    expect(serialized.split(JSON.stringify(freeBudgets))).toHaveLength(4);
  });
});
