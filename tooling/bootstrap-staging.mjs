import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function createStagingBootstrapSql(clientId, secret, now = new Date()) {
  if (!/^[a-z0-9-]+$/u.test(clientId)) throw new Error('Producer client identifier is unsafe');
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('Producer secret must contain at least 24 characters');
  const secretHash = createHash('sha256').update(secret).digest('hex');
  const measuredAt = now.toISOString();
  const windowStart = `${measuredAt.slice(0, 10)}T00:00:00.000Z`;
  const usage = ['d1Rows', 'queueOperations', 'r2Bytes'].map((resource) => `INSERT INTO capacity_usage
  (tenant_id, resource, window_start, used, measured_at)
  VALUES ('openings', '${resource}', '${windowStart}', 0, '${measuredAt}')
  ON CONFLICT(tenant_id, resource, window_start) DO NOTHING;`).join('\n');
  return `BEGIN IMMEDIATE;
INSERT INTO tenants (id, name, enabled) VALUES ('openings', 'Openings', 1)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name;
INSERT INTO producer_clients (id, tenant_id, name, enabled, secret_hash)
  VALUES ('${clientId}', 'openings', 'Openings preview pipeline', 1, '${secretHash}')
  ON CONFLICT(id) DO UPDATE SET secret_hash = excluded.secret_hash, enabled = 1;
${usage}
COMMIT;
`;
}

function main() {
  const clientId = process.env.PRODUCER_CLIENT_ID ?? 'openings-preview';
  const secret = process.env.PRODUCER_SIGNING_SECRET;
  if (!secret) throw new Error('PRODUCER_SIGNING_SECRET is required');
  process.stdout.write(createStagingBootstrapSql(clientId, secret));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
