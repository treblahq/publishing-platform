import { buildSignedHeaders, createPublishingClient } from '@trebla/publishing-client';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createR2CanaryEnvelope } from './r2-canary-staging.mjs';

export async function runStagingSmoke({ runId, submit, inspect, capacity }) {
  if (!/^[a-zA-Z0-9._-]+$/u.test(runId)) throw new Error('Smoke run identifier is unsafe');
  const capacityRows = await capacity();
  const resources = new Set(['d1Rows', 'queueOperations', 'r2Bytes']);
  if (!Array.isArray(capacityRows)
    || capacityRows.length !== resources.size
    || capacityRows.some((row) => !resources.has(row?.resource))) {
    throw new Error('Staging capacity report is incomplete');
  }
  if (capacityRows.some((row) => typeof row.percentOfFree !== 'number' || row.percentOfFree >= 40)) {
    throw new Error('Staging capacity reached the 40% free-tier gate');
  }
  const envelope = createR2CanaryEnvelope(`staging-smoke-${runId}`, 'Staging smoke test', runId);

  const accepted = await submit(envelope);
  if (accepted.outcome !== 'accepted') throw new Error('Staging smoke publication was not accepted');
  const record = await inspect(accepted.publicationId);
  if (!record?.publication || record.publication.id !== accepted.publicationId) {
    throw new Error('Staging smoke publication is missing from the ledger');
  }
  if (!Array.isArray(record.deliveries)
    || record.deliveries.length !== 1
    || record.deliveries[0]?.adapter !== 'web.r2') {
    throw new Error('Staging smoke publication is not R2-only');
  }
  return { publicationId: accepted.publicationId };
}

export async function verifyStagingFailureGuards({ baseUrl, secret, request = globalThis.fetch }) {
  const intakeUrl = `${baseUrl.replace(/\/+$/u, '')}/v1/publications`;
  const unauthorized = await request(intakeUrl, { method: 'POST', body: '{}' });
  if (unauthorized.status !== 401) throw new Error('Unauthenticated intake guard failed');

  const body = JSON.stringify({ schemaVersion: 1 });
  const headers = await buildSignedHeaders({
    clientId: 'openings-preview',
    secret,
    method: 'POST',
    path: '/v1/publications',
    tenant: 'openings',
    timestamp: new Date().toISOString(),
    nonce: randomUUID(),
    body,
  });
  const invalid = await request(intakeUrl, { method: 'POST', headers, body });
  if (invalid.status !== 400) throw new Error('Invalid publication guard failed');

  const admin = await request(`${baseUrl.replace(/\/+$/u, '')}/admin/capacity`, {
    headers: { authorization: 'Bearer intentionally-invalid-smoke-token' },
  });
  if (admin.status !== 401) throw new Error('Admin authentication guard failed');
}

async function main() {
  const baseUrl = requiredEnvironment('STAGING_BASE_URL').replace(/\/+$/u, '');
  const secret = requiredEnvironment('PRODUCER_SIGNING_SECRET');
  const adminToken = requiredEnvironment('ADMIN_TOKEN');
  const runId = process.env.GITHUB_RUN_ID ?? randomUUID();
  const client = createPublishingClient({ baseUrl, clientId: 'openings-preview', secret, nonce: randomUUID });
  await verifyStagingFailureGuards({ baseUrl, secret });
  const result = await runStagingSmoke({
    runId,
    submit: (envelope) => client.submit(envelope),
    inspect: (publicationId) => adminGet(baseUrl, adminToken, `/admin/publications/${encodeURIComponent(publicationId)}?tenant=openings`),
    capacity: () => adminGet(baseUrl, adminToken, '/admin/capacity'),
  });
  process.stdout.write(`Staging smoke accepted and recorded: ${result.publicationId}\n`);
}

async function adminGet(baseUrl, token, path) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Staging admin request returned HTTP ${String(response.status)}`);
  return response.json();
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
