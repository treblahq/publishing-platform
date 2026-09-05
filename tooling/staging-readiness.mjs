import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{11}[0-9]$/u;
const OPENINGS_PREVIEW = 'https://cloudflare-preview.openings-dev-web.pages.dev';
const OPENINGS_ONESIGNAL_APP_ID = '1215bd53-ffd9-4f11-b3c2-bb2999a1e500';
const ONESIGNAL_CANARY_SEGMENT = 'Publishing Platform Canary';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

export function assertStagingReady(config, now = new Date()) {
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
  assertOneSignalCanaryConfig(adapters?.openings?.['push.onesignal'], now);
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

function assertOneSignalCanaryConfig(oneSignal, now) {
  if (!oneSignal || typeof oneSignal !== 'object' || Array.isArray(oneSignal)) {
    throw new Error('Staging OneSignal canary configuration is missing');
  }
  if (Object.hasOwn(oneSignal, 'restApiKey')) {
    throw new Error('OneSignal API key must remain a Worker secret');
  }
  if (oneSignal.appId !== OPENINGS_ONESIGNAL_APP_ID) {
    throw new Error('Staging OneSignal app ID is not the verified Openings app');
  }
  if (oneSignal.audienceMode !== 'staging-segment') {
    throw new Error('Staging OneSignal must use staging-segment audience mode');
  }
  if (oneSignal.testSegment !== ONESIGNAL_CANARY_SEGMENT) {
    throw new Error('Staging OneSignal must use the isolated canary segment');
  }
  const attestation = oneSignal.attestation;
  const observedAt = Date.parse(attestation?.observedAt);
  const expiresAt = Date.parse(attestation?.expiresAt);
  const invalidAttestation = !Number.isSafeInteger(attestation?.observedMobileMau)
    || attestation.observedMobileMau < 0
    || attestation.providerCeiling !== 1_000
    || attestation.internalPause !== 700
    || attestation.observedMobileMau >= attestation.internalPause
    || !Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || observedAt > now.getTime()
    || expiresAt <= now.getTime()
    || expiresAt - observedAt > SEVEN_DAYS_MS
    || !/^[a-f0-9]{64}$/u.test(attestation?.evidenceHash ?? '');
  if (invalidAttestation) {
    throw new Error('Staging OneSignal free-tier attestation is invalid or stale');
  }
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
