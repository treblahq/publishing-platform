// Disposable fixture producer. No provider transport or production credentials.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { createPlatformPublisher, prepareArtifactReference } from '@trebla/publishing';

const { AbortSignal } = globalThis;
export const fixtureTenant = 'runtime-fixture';
export const fixtureClientId = 'runtime-fixture-client';
export const fixtureSecret = 'local-runtime-rehearsal-test-only-not-a-live-secret';
const origin = 'https://runtime-producer.invalid';
const identityKey = 'runtime-one-v1';

export function assertLoopbackUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Rehearsal requires an explicit loopback HTTP origin');
  return url.origin;
}

export function createLoopbackTransport(base, request = globalThis.fetch, loseAcceptance = false) {
  const loopback = assertLoopbackUrl(base);
  const result = { puts: 0, acceptedPublicationId: undefined, fetch: async (input, init = {}) => {
    if (typeof input !== 'string') throw new Error('Expected explicit synthetic URL');
    const url = new URL(input);
    const suffix = input.slice(origin.length);
    if (url.origin !== origin || input !== `${origin}${url.pathname}${url.search}` || url.username || url.password || url.hash
      || !((init.method === 'POST' && suffix === '/v1/publications') || (init.method === 'PUT' && suffix.startsWith('/v1/artifacts?') && url.pathname === '/v1/artifacts'))) throw new Error('Unsafe producer transport target');
    if (init.method === 'PUT') result.puts += 1;
    const response = await request(`${loopback}${suffix}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.redirected || (response.status >= 300 && response.status < 400)) throw new Error('Producer transport rejected redirect');
    if (loseAcceptance && init.method === 'POST' && response.ok) {
      const payload = await response.clone().json();
      if (typeof payload.publicationId === 'string' && payload.publicationId.trim()) {
        result.acceptedPublicationId = payload.publicationId;
        throw new Error('Simulated lost acceptance response');
      }
    }
    return response;
  } };
  return result;
}

async function absent(path) {
  try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

export async function runProducer(mode, directory, base) {
  if (!['submit-lost', 'recover'].includes(mode)) throw new Error('Unknown fixture producer mode');
  const adapter = createLoopbackTransport(base, globalThis.fetch, mode === 'submit-lost');
  const id = createHash('sha256').update(identityKey).digest('hex');
  const outboxDirectory = resolve(directory, 'producer-outbox');
  const handoffPath = resolve(outboxDirectory, id, 'handoff.json');
  const pendingPath = resolve(outboxDirectory, id, `${id}.json`);
  const acceptancePath = resolve(outboxDirectory, id, 'accepted', `${id}.json`);
  const filePath = resolve(directory, 'producer-fixture.png');
  const publisher = createPlatformPublisher({ outboxDirectory, transport: { baseUrl: origin, clientId: fixtureClientId, secret: fixtureSecret, fetch: adapter.fetch } });
  let handoff;
  if (mode === 'submit-lost') {
    if (!(await absent(handoffPath))) throw new Error('Fixture handoff already exists');
    await writeFile(filePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), { mode: 0o600, flag: 'wx' });
    const reference = await prepareArtifactReference({ id: 'fixture-image', filePath, mediaType: 'image/png', storage: 'r2-temporary', locator: hash => `temporary/${fixtureTenant}/fixture/${hash}.png`, allowedMediaTypes: ['image/png'], maxByteSize: 1024 });
    handoff = { envelope: { schemaVersion: 1, identity: { tenant: fixtureTenant, sourceType: 'fixture', sourceId: 'runtime-one', revision: '1', idempotencyKey: identityKey }, canonical: { title: 'Local technical fixture', language: 'en' }, artifacts: [reference], deliveries: [{ id: 'shadow', adapter: 'social.shadow', operation: 'compare', required: true, payload: { type: 'social.post', text: 'Local technical fixture; never published externally.', artifactIds: [reference.id] } }] }, uploads: [{ reference, filePath }] };
    await publisher.prepare(handoff);
    try { await publisher.submit(handoff); throw new Error('Expected lost acceptance response'); }
    catch (error) { if (error.message !== 'Simulated lost acceptance response' || !adapter.acceptedPublicationId) throw error; }
    await readFile(pendingPath);
    await readFile(handoffPath);
    if (!(await absent(acceptancePath)) || adapter.puts !== 1) throw new Error('Lost acceptance did not preserve pending state');
    return { status: 'acceptance-lost', publicationId: adapter.acceptedPublicationId, puts: adapter.puts, pid: process.pid, handoffPath, pendingPath, acceptancePath };
  }
  if (!(await absent(filePath)) || !(await absent(acceptancePath))) throw new Error('Recovery requires deleted fixture and no local acceptance');
  await readFile(pendingPath);
  handoff = JSON.parse(await readFile(handoffPath, 'utf8'));
  const recovered = await publisher.submit(handoff);
  const saved = JSON.parse(await readFile(acceptancePath, 'utf8'));
  if (recovered.outcome !== 'accepted' || saved.publicationId !== recovered.publicationId || adapter.puts !== 0 || !(await absent(pendingPath))) throw new Error('Fresh producer failed durable recovery');
  return { status: 'recovered', publicationId: recovered.publicationId, puts: adapter.puts, pid: process.pid, handoffPath, pendingPath, acceptancePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProducer(...process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
