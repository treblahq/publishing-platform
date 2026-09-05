import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/u;
const OPENINGS_PREVIEW = 'https://cloudflare-preview.openings-dev-web.pages.dev';

export function assertStagingReady(config) {
  const staging = config?.env?.staging;
  if (!staging || typeof staging !== 'object') throw new Error('Staging environment is missing');
  const database = staging.d1_databases?.[0];
  if (typeof database?.database_id !== 'string' || PLACEHOLDER_ID.test(database.database_id)) {
    throw new Error('Staging D1 database_id is still a placeholder');
  }
  const enabled = staging.vars?.ENABLED_ADAPTERS;
  if (enabled !== 'web.pages') {
    throw new Error('Staging must enable only the non-mutating web.pages adapter before canary approval');
  }
  let adapters;
  try { adapters = JSON.parse(staging.vars?.ADAPTER_CONFIGS ?? ''); } catch { throw new Error('Staging adapter configuration is invalid'); }
  if (adapters?.openings?.['web.pages']?.baseUrl !== OPENINGS_PREVIEW) {
    throw new Error('Staging Pages base URL must use the verified Openings preview alias');
  }
  if (config?.env?.production?.vars?.ENABLED_ADAPTERS !== '') {
    throw new Error('Production adapters must remain disabled before cutover');
  }
  for (const resource of [database?.database_name, ...(staging.r2_buckets ?? []).map((item) => item.bucket_name)]) {
    if (typeof resource !== 'string' || !resource.includes('staging') || resource.includes('production')) {
      throw new Error('Staging resources must be isolated from production');
    }
  }
  return true;
}

async function main() {
  const path = process.argv[2] ?? 'apps/worker/wrangler.json';
  const config = JSON.parse(await readFile(path, 'utf8'));
  assertStagingReady(config);
  process.stdout.write('Staging configuration is safe to deploy.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
