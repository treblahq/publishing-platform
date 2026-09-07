import process from 'node:process';
import { pathToFileURL } from 'node:url';

const PRODUCTION_HEALTH_URL = 'https://publishing-platform-production.business-850.workers.dev/health/live';

export async function verifyLiveHealth({
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  attempts = 6,
  delayMs = 5_000,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(PRODUCTION_HEALTH_URL, { signal: globalThis.AbortSignal.timeout(10_000) });
      const body = response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : undefined;
      if (response.ok && body?.status === 'live') return true;
    } catch {
      // Propagation and transient network failures are retried within the bound.
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Production Worker is not live after ${attempts} attempts`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyLiveHealth().then(() => {
    process.stdout.write('Production Worker is live.\n');
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
