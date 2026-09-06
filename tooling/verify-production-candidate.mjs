import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CAPACITY_RESOURCES = new Set(['d1Rows', 'queueOperations', 'r2Bytes']);

export async function verifyProductionCandidate({
  baseUrl, adminToken, entityPath, expected, fetch = globalThis.fetch, timeoutMs = 10_000,
}) {
  const origin = baseUrl.replace(/\/+$/u, '');
  const get = (path, headers = {}) => fetch(`${origin}${path}`, {
    method: 'GET', headers, signal: globalThis.AbortSignal.timeout(Math.min(timeoutMs, 10_000)),
  });

  const health = await get('/health/live');
  if (!health.ok || (await health.json()).status !== 'live') throw new Error('Production candidate is not live');

  const capacity = await get('/admin/capacity', { authorization: `Bearer ${adminToken}` });
  if (!capacity.ok) throw new Error('Production candidate capacity is unavailable');
  const rows = await capacity.json();
  if (!Array.isArray(rows) || rows.length !== CAPACITY_RESOURCES.size
    || rows.some((row) => !CAPACITY_RESOURCES.has(row?.resource)
      || typeof row?.percentOfFree !== 'number' || row.percentOfFree >= 40)) {
    throw new Error('Production candidate capacity is incomplete or unsafe');
  }

  const entity = await get(entityPath);
  if (!entity.ok || entity.headers.get('x-publishing-revision') !== expected.revision) {
    throw new Error('Production candidate entity revision is invalid');
  }
  const html = await entity.text();
  if (!html.includes(`<title>${expected.title}</title>`)
    || !html.includes(`rel="canonical" href="${expected.canonicalUrl}"`)) {
    throw new Error('Production candidate entity metadata is invalid');
  }
  return { healthy: true, capacitySafe: true, entityVerified: true };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const result = await verifyProductionCandidate({
    baseUrl: required('PRODUCTION_BASE_URL'),
    adminToken: required('ADMIN_TOKEN'),
    entityPath: required('KNOWN_ENTITY_PATH'),
    expected: {
      title: required('EXPECTED_ENTITY_TITLE'),
      canonicalUrl: required('EXPECTED_CANONICAL_URL'),
      revision: required('EXPECTED_REVISION'),
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
