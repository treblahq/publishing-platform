import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('wrangler environment isolation', () => {
  it('isolates each delivery invocation within the external subrequest budget', () => {
    const config = JSON.parse(readFileSync(resolve('apps/worker/wrangler.json'), 'utf8')) as {
      queues: { consumers: { max_batch_size?: number }[] };
      env: { production: { queues: { consumers: { max_batch_size?: number }[] } } };
    };
    // One full carousel needs 20 public media reads plus channel and creation calls.
    // The default batch of ten could multiply these beyond the free limit of 50.
    for (const consumer of [...config.queues.consumers, ...config.env.production.queues.consumers]) {
      expect(consumer.max_batch_size).toBe(1);
    }
  });

  it('uses production as the only remote environment', () => {
    const path = resolve('apps/worker/wrangler.json');
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(config).not.toHaveProperty('env.staging');
    expect(config).toHaveProperty('env.production');
    const serialized = JSON.stringify(config);
    expect(serialized).toContain('DELIVERY_DLQ');
    expect(config).toHaveProperty('queues.consumers.1.queue', 'publishing-delivery-dlq-local');
    expect(config).toHaveProperty('env.production.queues.consumers.1.queue', 'publishing-delivery-dlq-production');
    expect(config).toHaveProperty('env.production.d1_databases.0.database_name', 'publishing-platform-staging');
    expect(serialized).toContain('ENABLED_ADAPTERS');
    expect(serialized).toContain('publishing-artifacts-local');
    expect(serialized).toContain('publishing-artifacts-staging');
    expect(config).toHaveProperty('env.production.r2_buckets.0.bucket_name', 'publishing-artifacts-staging');
    expect(config).toHaveProperty('vars.ENABLED_ADAPTERS', '');
    expect(config).toHaveProperty('env.production.vars.ENABLED_ADAPTERS', 'web.r2,social.shadow,social.mastodon');
    expect(config).toHaveProperty('env.production.vars.ADAPTER_CONFIGS');
    expect(serialized).toContain('https://openings-dev-web-dfy.pages.dev');
    expect(serialized).not.toContain('cloudflare-preview.openings-dev-web.pages.dev');
    const freeBudgets = JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 });
    expect(serialized.split(JSON.stringify(freeBudgets))).toHaveLength(3);
  });
});
