import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{11}[0-9]$/u;
const PROMOTED_DATABASE = 'publishing-platform-staging';
const PROMOTED_BUCKET = 'publishing-artifacts-staging';
const OPENINGS_PREVIEW = 'https://cloudflare-preview.openings-dev-web.pages.dev';

export function assertProductionReady(config) {
  const production = config?.env?.production;
  const staging = config?.env?.staging;
  if (!production || !staging) throw new Error('Production and staging environments are required');
  if (production.name !== 'publishing-platform-production') throw new Error('Production Worker name is invalid');

  const database = production.d1_databases?.[0];
  if (typeof database?.database_id !== 'string' || PLACEHOLDER_ID.test(database.database_id)) {
    throw new Error('Production D1 database_id is still a placeholder');
  }
  if (database.database_name !== PROMOTED_DATABASE) throw new Error('Production must bind the promoted D1 database');
  if (production.r2_buckets?.[0]?.bucket_name !== PROMOTED_BUCKET) {
    throw new Error('Production must bind the promoted R2 bucket');
  }
  if (production.vars?.ENABLED_ADAPTERS !== 'web.r2') {
    throw new Error('Production candidate must enable only web.r2');
  }

  let adapters;
  try { adapters = JSON.parse(production.vars?.ADAPTER_CONFIGS ?? ''); } catch {
    throw new Error('Production adapter configuration is invalid');
  }
  if (Object.keys(adapters ?? {}).some((tenant) => tenant !== 'openings')) {
    throw new Error('Production candidate contains an unknown tenant adapter');
  }
  const openings = adapters?.openings;
  if (!openings || Object.keys(openings).some((adapter) => adapter !== 'web.r2')) {
    throw new Error('Social and push adapters must remain absent');
  }
  const web = openings['web.r2'];
  if (web?.publicBaseUrl !== OPENINGS_PREVIEW || web.shellBaseUrl !== OPENINGS_PREVIEW
    || web.canonicalBaseUrl !== 'https://openings.dev') {
    throw new Error('Production web URLs must use the approved candidate and canonical origins');
  }

  const productionQueues = [...(production.queues?.producers ?? []), ...(production.queues?.consumers ?? [])]
    .flatMap((entry) => [entry.queue, entry.dead_letter_queue]).filter(Boolean);
  if (!productionQueues.includes('publishing-delivery-production')
    || !productionQueues.includes('publishing-delivery-dlq-production')
    || productionQueues.some((queue) => queue.includes('staging'))) {
    throw new Error('Production messaging must use only dedicated production queues');
  }
  if ((staging.queues?.consumers?.length ?? 0) > 0) throw new Error('Staging queue consumers must be retired');
  if ((staging.triggers?.crons?.length ?? 0) > 0) throw new Error('Staging scheduled triggers must be retired');
  return true;
}

async function main() {
  const path = process.argv[2] ?? 'apps/worker/wrangler.json';
  assertProductionReady(JSON.parse(await readFile(path, 'utf8')));
  process.stdout.write('Production candidate configuration is safe to deploy.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
