import { createPublishingClient } from '@treblahq/publishing-client';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export async function runStagingSmoke({ runId, submit, inspect }) {
  if (!/^[a-zA-Z0-9._-]+$/u.test(runId)) throw new Error('Smoke run identifier is unsafe');
  const envelope = {
    schemaVersion: 1,
    identity: {
      tenant: 'openings',
      sourceType: 'staging-smoke',
      sourceId: `staging-smoke-${runId}`,
      revision: '1',
      idempotencyKey: `staging-smoke:${runId}`,
    },
    canonical: {
      title: 'Staging smoke test',
      summary: 'Sanitized Pages-only pipeline verification.',
      canonicalUrl: 'https://cloudflare-preview.openings-dev-web.pages.dev/',
      language: 'en',
    },
    artifacts: [],
    deliveries: [{
      id: 'verify-preview-home',
      adapter: 'web.pages',
      operation: 'publish',
      required: true,
      payload: { type: 'web.page', route: '/' },
    }],
  };

  const accepted = await submit(envelope);
  if (accepted.outcome !== 'accepted') throw new Error('Staging smoke publication was not accepted');
  const record = await inspect(accepted.publicationId);
  if (!record?.publication || record.publication.id !== accepted.publicationId) {
    throw new Error('Staging smoke publication is missing from the ledger');
  }
  if (!Array.isArray(record.deliveries)
    || record.deliveries.length !== 1
    || record.deliveries[0]?.adapter !== 'web.pages') {
    throw new Error('Staging smoke publication is not Pages-only');
  }
  return { publicationId: accepted.publicationId };
}

async function main() {
  const baseUrl = requiredEnvironment('STAGING_BASE_URL').replace(/\/+$/u, '');
  const secret = requiredEnvironment('PRODUCER_SIGNING_SECRET');
  const adminToken = requiredEnvironment('ADMIN_TOKEN');
  const runId = process.env.GITHUB_RUN_ID ?? randomUUID();
  const client = createPublishingClient({ baseUrl, clientId: 'openings-preview', secret, nonce: randomUUID });
  const result = await runStagingSmoke({
    runId,
    submit: (envelope) => client.submit(envelope),
    inspect: async (publicationId) => {
      const response = await globalThis.fetch(`${baseUrl}/admin/publications/${encodeURIComponent(publicationId)}?tenant=openings`, {
        headers: { authorization: `Bearer ${adminToken}` },
      });
      if (!response.ok) throw new Error(`Staging admin inspection returned HTTP ${String(response.status)}`);
      return response.json();
    },
  });
  process.stdout.write(`Staging smoke accepted and recorded: ${result.publicationId}\n`);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
