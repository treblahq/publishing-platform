import { readFile } from 'node:fs/promises';
import { createPlatformPublisher, validatePublicationEnvelope } from '@trebla/publishing';

interface SubmitArguments { handoffPath: string; tenant: string; outboxDirectory: string }

export function parseProducerSubmitArguments(args: string[]): SubmitArguments {
  const [handoffPath, tenantFlag, tenant, outboxFlag, outboxDirectory] = args;
  if (args.length !== 5 || !handoffPath || tenantFlag !== '--tenant' || !tenant
    || outboxFlag !== '--outbox' || !outboxDirectory) {
    throw new Error('Usage: publishing submit HANDOFF --tenant TENANT --outbox DIRECTORY');
  }
  return { handoffPath, tenant, outboxDirectory };
}

export async function submitProducerHandoff(
  args: SubmitArguments,
  env: Record<string, string | undefined>,
  request: typeof fetch = globalThis.fetch,
) {
  const value: unknown = JSON.parse(await readFile(args.handoffPath, 'utf8'));
  if (!value || typeof value !== 'object' || !('envelope' in value) || !('uploads' in value)
    || !Array.isArray(value.uploads)) throw new Error('Invalid platform handoff');
  const envelope = validatePublicationEnvelope(value.envelope);
  if (envelope.identity.tenant !== args.tenant) throw new Error('Handoff tenant does not match the requested tenant');
  if (envelope.deliveries.some(delivery => delivery.adapter !== 'social.shadow' || delivery.operation !== 'compare')) {
    throw new Error('Producer rollout currently accepts shadow deliveries only');
  }
  if (envelope.artifacts.some(artifact => artifact.byteSize > 50 * 1024 * 1024)) {
    throw new Error('Artifact exceeds the 50 MiB upload safety limit');
  }
  const { PUBLISHING_ENDPOINT: baseUrl, PUBLISHING_CLIENT_ID: clientId, PUBLISHING_CLIENT_SECRET: secret } = env;
  if (!baseUrl || !clientId || !secret) throw new Error('Publishing endpoint and producer credentials are required');
  const publisher = createPlatformPublisher({ outboxDirectory: args.outboxDirectory,
    transport: { baseUrl, clientId, secret, fetch: request },
  });
  return publisher.submit({ envelope, uploads: value.uploads });
}
