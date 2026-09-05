import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createPublishingClient } from '@treblahq/publishing-client';

const CONFIRMATION = 'SEND ONE OPENINGS CANARY';

export async function runOneSignalCanary({
  envelope,
  submit,
  inspect,
  setAdapter,
  wait,
  attempts = 30,
}) {
  await setAdapter(true);
  try {
    const accepted = await submit(envelope);
    if (accepted.outcome !== 'accepted') throw new Error('OneSignal canary publication was not accepted');
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const record = await inspect(accepted.publicationId);
      const deliveries = Array.isArray(record?.deliveries) ? record.deliveries : [];
      const web = deliveries.find((delivery) => delivery?.adapter === 'web.pages');
      const push = deliveries.find((delivery) => delivery?.adapter === 'push.onesignal');
      if (web?.state === 'verified' && push?.state === 'verified') {
        return { publicationId: accepted.publicationId };
      }
      await wait();
    }
    throw new Error('OneSignal canary did not verify before the deadline');
  } finally {
    await setAdapter(false);
  }
}

async function main() {
  if (requiredEnvironment('CONFIRM_CANARY') !== CONFIRMATION) throw new Error('Exact canary confirmation is required');
  const baseUrl = requiredEnvironment('STAGING_BASE_URL').replace(/\/+$/u, '');
  const adminToken = requiredEnvironment('ADMIN_TOKEN');
  const jobId = requiredEnvironment('CANARY_JOB_ID');
  const jobTitle = requiredEnvironment('CANARY_JOB_TITLE');
  const runId = requiredEnvironment('GITHUB_RUN_ID');
  if (!/^[a-zA-Z0-9._-]+$/u.test(jobId) || !/^[0-9]+$/u.test(runId)) throw new Error('Canary identifiers are unsafe');
  const client = createPublishingClient({
    baseUrl,
    clientId: 'openings-preview',
    secret: requiredEnvironment('PRODUCER_SIGNING_SECRET'),
    nonce: randomUUID,
  });
  const envelope = createCanaryEnvelope(jobId, jobTitle, runId);
  const result = await runOneSignalCanary({
    envelope,
    submit: (value) => client.submit(value),
    inspect: (publicationId) => adminRequest(baseUrl, adminToken, `/admin/publications/${encodeURIComponent(publicationId)}?tenant=openings`),
    setAdapter: (enabled) => adminRequest(
      baseUrl,
      adminToken,
      `/admin/adapters/openings/push.onesignal/${enabled ? 'resume' : 'pause'}`,
      { reason: `OneSignal canary ${runId}: ${enabled ? 'start' : 'complete'}` },
    ),
    wait: () => new Promise((resolve) => globalThis.setTimeout(resolve, 2_000)),
  });
  process.stdout.write(`OneSignal canary verified: ${result.publicationId}\n`);
}

function createCanaryEnvelope(jobId, jobTitle, runId) {
  const canonicalUrl = `https://openings.dev/jobs/${encodeURIComponent(jobId)}`;
  return {
    schemaVersion: 1,
    identity: {
      tenant: 'openings',
      sourceType: 'staging-canary',
      sourceId: jobId,
      revision: runId,
      idempotencyKey: `staging-canary:${runId}`,
    },
    canonical: { title: jobTitle, summary: 'Isolated OneSignal staging canary.', canonicalUrl, language: 'pt-BR' },
    artifacts: [],
    deliveries: [
      {
        id: 'web',
        adapter: 'web.pages',
        operation: 'publish',
        required: true,
        payload: {
          type: 'web.page',
          route: `/jobs/${jobId}`,
          expectedTitle: jobTitle,
          expectedCanonicalUrl: canonicalUrl,
        },
      },
      {
        id: 'push',
        adapter: 'push.onesignal',
        operation: 'publish',
        required: true,
        dependsOn: [{ deliveryId: 'web', state: 'verified' }],
        payload: {
          type: 'push.notification',
          audience: { type: 'all-subscribers' },
          title: 'Canário do Openings',
          body: jobTitle,
          url: canonicalUrl,
        },
      },
    ],
  };
}

async function adminRequest(baseUrl, token, path, body) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
