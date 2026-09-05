import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createPublishingClient } from '@treblahq/publishing-client';

export function createR2CanaryEnvelope(jobId, jobTitle, runId) {
  const content = { title: jobTitle, canary: true };
  return {
    schemaVersion: 1,
    identity: { tenant: 'openings', sourceType: 'staging-r2-canary', sourceId: jobId,
      revision: runId, idempotencyKey: `staging-r2-canary:${runId}` },
    canonical: { title: jobTitle, summary: 'Isolated R2 staging canary.',
      canonicalUrl: `https://openings.dev/jobs/${encodeURIComponent(jobId)}`, language: 'pt-BR' },
    artifacts: [],
    deliveries: [{ id: 'web', adapter: 'web.r2', operation: 'publish', required: true,
      payload: { type: 'web.page', route: `/jobs/${jobId}`, entity: {
        schemaVersion: 1, tenant: 'openings', kind: 'job', id: jobId, revision: runId,
        canonicalPath: `/jobs/${jobId}`, title: jobTitle, summary: 'Isolated R2 staging canary.',
        status: 'active', contentSha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'), content,
      } } }],
  };
}

async function main() {
  const baseUrl = required('STAGING_BASE_URL').replace(/\/+$/u, '');
  const adminToken = required('ADMIN_TOKEN');
  const client = createPublishingClient({ baseUrl, clientId: 'openings-preview',
    secret: required('PRODUCER_SIGNING_SECRET'), nonce: randomUUID });
  const accepted = await client.submit(createR2CanaryEnvelope(required('CANARY_JOB_ID'), required('CANARY_JOB_TITLE'), required('GITHUB_RUN_ID')));
  if (accepted.outcome !== 'accepted') throw new Error('R2 canary was not accepted');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await globalThis.fetch(`${baseUrl}/admin/publications/${encodeURIComponent(accepted.publicationId)}?tenant=openings`,
      { headers: { authorization: `Bearer ${adminToken}` } });
    if (!response.ok) throw new Error(`R2 canary inspection returned HTTP ${response.status}`);
    const record = await response.json();
    if (record?.deliveries?.some((delivery) => delivery.adapter === 'web.r2' && delivery.state === 'verified')) {
      process.stdout.write(`R2 canary verified: ${accepted.publicationId}\n`); return;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 2_000));
  }
  throw new Error('R2 canary did not verify');
}

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
