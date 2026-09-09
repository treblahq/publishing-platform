// Opt-in disposable local runtime rehearsal; importing has no side effects.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { buildSignedHeaders } from '@trebla/publishing';
import { assertLoopbackUrl, fixtureTenant as tenant, fixtureClientId as clientId, fixtureSecret as secret } from './rehearse-producer.mjs';

export { assertLoopbackUrl } from './rehearse-producer.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { fetch, AbortSignal } = globalThis;
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const database = 'runtime-fixture-ledger';

export function buildRuntimeConfig() {
  return {
    name: 'runtime-fixture-worker', main: resolve(root, 'apps/worker/src/index.ts'),
    compatibility_date: '2026-09-04',
    d1_databases: [{ binding: 'LEDGER', database_name: database, database_id: '00000000-0000-0000-0000-000000000099', migrations_dir: resolve(root, 'apps/worker/migrations') }],
    r2_buckets: [{ binding: 'ARTIFACTS', bucket_name: 'runtime-fixture-artifacts' }],
    queues: {
      producers: [{ binding: 'DELIVERY_QUEUE', queue: 'runtime-fixture-delivery' }, { binding: 'DELIVERY_DLQ', queue: 'runtime-fixture-dlq' }],
      consumers: [{ queue: 'runtime-fixture-delivery', max_batch_size: 1, max_batch_timeout: 1, max_retries: 0, dead_letter_queue: 'runtime-fixture-dlq' }, { queue: 'runtime-fixture-dlq', max_batch_size: 1, max_retries: 0 }],
    },
    vars: { CAPACITY_BUDGETS: JSON.stringify({ d1Rows: 55000, queueOperations: 5500, r2Bytes: 5500000000 }), ENABLED_ADAPTERS: 'social.shadow', ADAPTER_CONFIGS: '{}', PRODUCER_SECRETS: JSON.stringify({ [clientId]: secret }) },
  };
}

export function buildRuntimeEnvironment(source, directory) {
  return { PATH: source.PATH ?? '', TMPDIR: directory, XDG_CONFIG_HOME: directory, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(directory, 'wrangler.log'), CI: 'true', NO_COLOR: '1', WRANGLER_LOG: 'log', WRANGLER_DISABLE_AUTO_UPDATE: 'true' };
}

export function assertNoLegacyConfiguration(exists) {
  if (exists) throw new Error('Refusing inherited Wrangler legacy home configuration');
}

export function buildRuntimeCommand(action, directory, port) {
  const local = ['--local', '--config', resolve(directory, 'wrangler.json'), '--persist-to', resolve(directory, 'state')];
  if (action === 'migrate') return ['d1', 'migrations', 'apply', database, ...local];
  if (action === 'seed') return ['d1', 'execute', database, ...local, '--file', resolve(directory, 'seed.sql'), '--json'];
  if (action === 'inspect') return ['d1', 'execute', database, ...local, '--command', 'SELECT (SELECT COUNT(*) FROM publications) AS publications, (SELECT COUNT(*) FROM deliveries) AS deliveries, (SELECT COUNT(*) FROM receipts) AS receipts, (SELECT COUNT(*) FROM attempts) AS attempts, (SELECT COUNT(*) FROM artifact_uploads) AS uploads;', '--json'];
  if (action === 'dev' && Number.isInteger(port) && port > 1024 && port < 65536) return ['dev', ...local, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', '0'];
  throw new Error('Unsupported local rehearsal action');
}

export function buildProducerCommand(mode, directory, base) {
  if (!['submit-lost', 'recover'].includes(mode)) throw new Error('Unsupported fixture producer action');
  return [resolve(root, 'tooling/rehearse-producer.mjs'), mode, directory, assertLoopbackUrl(base)];
}

async function availablePort() {
  const server = createServer();
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const port = server.address().port;
  await new Promise((yes, no) => server.close(error => error ? no(error) : yes()));
  return port;
}

export async function withRuntimeProcesses(task) {
  if (process.platform === 'win32') throw new Error('Local rehearsal requires POSIX process-group cleanup');
  const children = new Set();
  const stopping = new Map();
  let interrupted = false;
  const scope = {
    assertActive() { if (interrupted) throw new Error('Local rehearsal interrupted'); },
    track(child) { children.add(child); if (interrupted) void scope.stop(child); },
    stop(child) {
      if (!stopping.has(child)) stopping.set(child, stopProcessGroup(child).finally(() => children.delete(child)));
      return stopping.get(child);
    },
  };
  const clean = () => Promise.all([...children].map(child => scope.stop(child)));
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    if (interrupted) return;
    interrupted = true;
    void clean().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try { return await task(scope); }
  finally {
    await clean();
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

async function stopProcessGroup(child) {
  if (!child.pid) return;
  const signal = name => { try { process.kill(-child.pid, name); } catch { /* Group already exited. */ } };
  const exists = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };
  signal('SIGTERM');
  for (let attempt = 0; attempt < 20 && exists(); attempt += 1) await delay(50);
  // Check the process group, not only Wrangler: workerd can outlive its parent.
  if (exists()) signal('SIGKILL');
  for (let attempt = 0; attempt < 20 && exists(); attempt += 1) await delay(50);
}

function launch(args, directory, scope, executable = cli) {
  scope.assertActive();
  const child = spawn(process.execPath, [executable, ...args], { cwd: directory, env: buildRuntimeEnvironment(process.env, directory), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  scope.track(child);
  let output = '';
  const capture = chunk => { output = (output + chunk.toString()).slice(-65536); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const done = new Promise(resolveDone => {
    child.once('error', () => resolveDone(-1));
    child.once('exit', code => resolveDone(code));
  });
  return { child, done, output: () => output, scope };
}

async function stop(run) {
  if (!run) return;
  await run.scope.stop(run.child);
}

async function command(action, directory, port, scope) {
  const run = launch(buildRuntimeCommand(action, directory, port), directory, scope);
  try {
    const code = await Promise.race([run.done, delay(60000, undefined, { ref: false }).then(() => 'timeout')]);
    if (code !== 0) throw new Error(`Local ${action} failed (${String(code)}); inspect disposable logs`);
    return run.output();
  } finally { await stop(run); }
}

async function producer(mode, directory, base, scope) {
  const [executable, ...args] = buildProducerCommand(mode, directory, base);
  const run = launch(args, directory, scope, executable);
  try {
    const code = await Promise.race([run.done, delay(45000, undefined, { ref: false }).then(() => 'timeout')]);
    if (code !== 0) throw new Error(`Fixture producer ${mode} failed (${String(code)}): ${run.output()}`);
    return JSON.parse(run.output());
  } finally { await stop(run); }
}

async function request(base, path, method = 'GET', body = '') {
  assertLoopbackUrl(base);
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid local request path');
  const headers = await buildSignedHeaders({ clientId, secret, tenant, method, path, timestamp: new Date().toISOString(), nonce: randomUUID(), body });
  const response = await fetch(`${base}${path}`, { method, headers, ...(method === 'GET' ? {} : { body }), redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Local ${method} failed with HTTP ${response.status}`);
  return response.json();
}

async function ready(run, base) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (run.child.exitCode !== null) throw new Error('Local Worker exited before readiness');
    try {
      const response = await fetch(`${assertLoopbackUrl(base)}/health/live`, { redirect: 'error', signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).status === 'live') return;
    } catch { /* Bounded startup retry. */ }
    await delay(500);
  }
  throw new Error('Local Worker readiness timed out');
}

export function isVerifiedShadowReceipt(delivery) {
  return delivery?.state === 'verified' && delivery.provider === 'social.shadow' && /^shadow:[a-f0-9]{64}$/u.test(delivery.remoteId);
}

async function receipt(base, publicationId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await request(base, `/v1/publications/${encodeURIComponent(publicationId)}`);
    if (status.deliveries?.length === 1) {
      const delivery = status.deliveries[0];
      if (isVerifiedShadowReceipt(delivery)) return delivery;
    }
    await delay(500);
  }
  throw new Error('Local shadow receipt timed out');
}

export function runRuntimeRehearsal() {
  return withRuntimeProcesses(runScopedRehearsal);
}

async function runScopedRehearsal(scope) {
  // Wrangler gives ~/.wrangler priority over XDG_CONFIG_HOME. Never inherit it.
  const legacy = await lstat(resolve(homedir(), '.wrangler')).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw new Error('Cannot verify absence of legacy Wrangler configuration');
  });
  assertNoLegacyConfiguration(legacy !== null);
  const directory = await mkdtemp(resolve(tmpdir(), 'publishing-runtime-'));
  let server;
  try {
    await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify(buildRuntimeConfig()), { mode: 0o600 });
    const now = new Date().toISOString();
    const hash = createHash('sha256').update(secret).digest('hex');
    const seed = `INSERT INTO tenants (id,name,enabled) VALUES ('${tenant}','Runtime fixture',1); INSERT INTO producer_clients (id,tenant_id,name,enabled,secret_hash) VALUES ('${clientId}','${tenant}','Fixture',1,'${hash}');` + ['d1Rows', 'queueOperations', 'r2Bytes'].map(resource => `INSERT INTO capacity_usage VALUES ('${tenant}','${resource}','${now}',0,'${now}');`).join('');
    await writeFile(resolve(directory, 'seed.sql'), seed, { mode: 0o600 });
    await command('migrate', directory, undefined, scope);
    await command('seed', directory, undefined, scope);
    const port = await availablePort();
    const base = assertLoopbackUrl(`http://127.0.0.1:${port}`);
    server = launch(buildRuntimeCommand('dev', directory, port), directory, scope);
    await ready(server, base);
    const accepted = await producer('submit-lost', directory, base, scope);
    if (accepted.status !== 'acceptance-lost' || typeof accepted.publicationId !== 'string' || accepted.puts !== 1) throw new Error('Producer did not simulate lost remote acceptance');
    const first = await receipt(base, accepted.publicationId);
    await stop(server);
    await unlink(resolve(directory, 'producer-fixture.png'));
    server = launch(buildRuntimeCommand('dev', directory, port), directory, scope);
    await ready(server, base);
    const replay = await producer('recover', directory, base, scope);
    if (replay.status !== 'recovered' || replay.publicationId !== accepted.publicationId || replay.puts !== 0 || replay.pid === accepted.pid) throw new Error('Fresh producer did not recover the same acceptance without uploads');
    const second = await receipt(base, replay.publicationId);
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Restart changed the shadow receipt');
    await stop(server);
    const rows = JSON.parse(await command('inspect', directory, undefined, scope));
    const counts = rows[0]?.results?.[0];
    if (!counts || ['publications', 'deliveries', 'receipts', 'attempts', 'uploads'].some(key => counts[key] !== 1)) throw new Error('Local ledger contains unexpected duplicate counts');
    return { status: 'passed', workerRestartReplay: 'persisted-publication-and-receipt-idempotency', producerRecovery: 'fresh-process-persisted-handoff-after-lost-acceptance', recoveryPuts: replay.puts, producerPids: [accepted.pid, replay.pid], counts, directory, evidence: 'local-only; not production CPU, public gateway or live provider validation' };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : 'Local rehearsal failed'}; disposable state: ${directory}`);
  } finally { await stop(server); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeRehearsal().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
