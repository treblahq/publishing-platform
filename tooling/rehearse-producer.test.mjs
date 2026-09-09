import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { buildRuntimeEnvironment } from './rehearse-runtime.mjs';
import * as helper from './rehearse-producer.mjs';

const { Response } = globalThis;
it('maps only the fixed synthetic HTTPS origin and exact package endpoints to loopback', async () => {
  expect(helper.createLoopbackTransport).toBeTypeOf('function');
  const calls = [];
  const transport = helper.createLoopbackTransport('http://127.0.0.1:8799', async (...args) => { calls.push(args); return Response.json({}); });
  await transport.fetch('https://runtime-producer.invalid/v1/publications', { method: 'POST', body: '{}' });
  expect(calls[0][0]).toBe('http://127.0.0.1:8799/v1/publications');
  expect(calls[0][1].redirect).toBe('error');
  for (const url of ['https://evil.test/v1/publications', 'http://runtime-producer.invalid/v1/publications', 'https://runtime-producer.invalid/x/../v1/publications', 'https://runtime-producer.invalid/v1/%70ublications', 'https://runtime-producer.invalid//evil', 'https://runtime-producer.invalid/v1/publications#x']) {
    await expect(transport.fetch(url, { method: 'POST' })).rejects.toThrow();
  }
  expect(calls).toHaveLength(1);
  expect(() => helper.createLoopbackTransport('http://localhost:8799')).toThrow();
});

it('drops only a successful acceptance response and rejects redirects', async () => {
  expect(helper.createLoopbackTransport).toBeTypeOf('function');
  const responses = [Response.json({ code: 'ARTIFACT_NOT_READY' }, { status: 409 }), Response.json({ publicationId: 'one' }, { status: 202 })];
  const transport = helper.createLoopbackTransport('http://127.0.0.1:8799', async () => responses.shift(), true);
  expect((await transport.fetch('https://runtime-producer.invalid/v1/publications', { method: 'POST' })).status).toBe(409);
  expect(transport.acceptedPublicationId).toBeUndefined();
  await expect(transport.fetch('https://runtime-producer.invalid/v1/publications', { method: 'POST' })).rejects.toThrow('Simulated lost acceptance');
  expect(transport.acceptedPublicationId).toBe('one');
  const redirect = helper.createLoopbackTransport('http://127.0.0.1:8799', async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }));
  await expect(redirect.fetch('https://runtime-producer.invalid/v1/publications', { method: 'POST' })).rejects.toThrow('redirect');
});

it('uses separate actual producer children to persist lost acceptance then recover after fixture deletion', async () => {
  expect(helper.createLoopbackTransport).toBeTypeOf('function');
  const directory = await mkdtemp(resolve(tmpdir(), 'producer-child-test-'));
  let uploaded = false;
  const methods = [];
  const server = createServer(async (req, res) => {
    methods.push(req.method);
    for await (const chunk of req) void chunk;
    if (req.method === 'PUT') uploaded = true;
    res.writeHead(req.method === 'PUT' ? 201 : uploaded ? 202 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.method === 'PUT' ? { status: 'stored' } : uploaded ? { publicationId: 'publication-one' } : { code: 'ARTIFACT_NOT_READY' }));
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = mode => new Promise((done, fail) => {
    const child = spawn(process.execPath, [new URL('./rehearse-producer.mjs', import.meta.url).pathname, mode, directory, base], { env: buildRuntimeEnvironment(process.env, directory), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('Producer timeout')); }, 10000);
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) { fail(new Error(err)); return; }
      try { done(JSON.parse(out)); } catch (error) { fail(error); }
    });
  });
  try {
    const first = await run('submit-lost');
    expect(first).toMatchObject({ status: 'acceptance-lost', publicationId: 'publication-one', puts: 1 });
    expect(JSON.parse(await readFile(first.handoffPath, 'utf8')).uploads).toHaveLength(1);
    await expect(readFile(first.acceptancePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await readFile(first.pendingPath);
    await unlink(resolve(directory, 'producer-fixture.png'));
    methods.length = 0;
    const second = await run('recover');
    expect(second).toMatchObject({ status: 'recovered', publicationId: first.publicationId, puts: 0 });
    expect(second.pid).not.toBe(first.pid);
    expect(methods).toEqual(['POST']);
    expect(JSON.parse(await readFile(first.acceptancePath, 'utf8'))).toEqual({ publicationId: first.publicationId });
    await expect(readFile(first.pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
}, 20000);
