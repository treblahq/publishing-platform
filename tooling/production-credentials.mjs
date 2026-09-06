import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{11}[0-9]$/u;

export function assertProductionCredentials(environment) {
  const token = environment.CLOUDFLARE_API_TOKEN;
  if (typeof token !== 'string' || !token.startsWith('cfut_') || token.length <= 5 || /\s/u.test(token)) {
    throw new Error('CLOUDFLARE_API_TOKEN must be a Cloudflare user API token (cfut_)');
  }
  if (!ACCOUNT_ID.test(environment.CLOUDFLARE_ACCOUNT_ID ?? '')) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is missing or malformed');
  }
  const databaseId = environment.CLOUDFLARE_D1_DATABASE_ID ?? '';
  if (!UUID.test(databaseId) || PLACEHOLDER_ID.test(databaseId)) {
    throw new Error('CLOUDFLARE_D1_DATABASE_ID is missing, malformed, or a placeholder');
  }
  if (typeof environment.ADMIN_TOKEN !== 'string' || environment.ADMIN_TOKEN.length === 0) {
    throw new Error('ADMIN_TOKEN is missing');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertProductionCredentials(process.env);
    process.stdout.write('Production candidate credentials passed structural checks.\n');
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Production credential preflight failed'}\n`);
    process.exitCode = 1;
  }
}
