import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as api from './index.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'platform-publisher-'));
  directories.push(directory);
  const filePath = join(directory, 'image.png');
  await writeFile(filePath, 'approved-image');
  const artifact = await api.prepareArtifactReference({
    id: 'image', filePath, mediaType: 'image/png', storage: 'r2-temporary',
    locator: hash => `temporary/trebla/story/${hash}.png`,
    allowedMediaTypes: ['image/png'], maxByteSize: 100,
  });
  const handoff: api.PlatformHandoff = {
    envelope: { schemaVersion: 1, identity: { tenant: 'trebla', sourceType: 'story', sourceId: 'one', revision: 'one', idempotencyKey: 'trebla:story:one:one' },
      canonical: { title: 'Approved', language: 'pt-BR' }, artifacts: [artifact],
      deliveries: [{ id: 'shadow', adapter: 'social.shadow', operation: 'compare', required: false,
        payload: { type: 'social.post', text: 'Approved copy', artifactIds: ['image'] } }],
    }, uploads: [{ reference: artifact, filePath }],
  };
  const requests: string[] = [];
  const submissions: string[] = [];
  let uploaded = false;
  const transport = { baseUrl: 'https://publisher.example', clientId: 'trebla-producer', secret: 'local-test-only',
    fetch: (async (_url, init) => {
      requests.push(init?.method ?? 'GET');
      if (init?.method === 'PUT') {
        await new Response(init.body).text();
        uploaded = true;
        return Response.json({ status: 'stored' });
      }
      if (typeof init?.body !== 'string') throw new Error('Expected a serialized envelope');
      submissions.push(init.body);
      if (!uploaded) return Response.json({ code: 'ARTIFACT_NOT_READY' }, { status: 409 });
      return Response.json({ publicationId: 'publication-one' });
    }) as typeof fetch,
  };
  return { directory, handoff, requests, submissions, transport };
}

describe('complete product handoff', () => {
  it('exposes a reusable publisher for every product', () => {
    expect(api.createPlatformPublisher).toBeTypeOf('function');
  });

  it('prepares durably offline, probes then uploads and submits, and reuses acceptance offline', async () => {
    const f = await fixture();
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    const prepared = await publisher.prepare(f.handoff);
    expect(f.requests).toEqual([]);
    expect(JSON.parse(await readFile(prepared.path, 'utf8'))).toEqual(f.handoff);
    await expect(publisher.submit(f.handoff)).resolves.toEqual({ outcome: 'accepted', publicationId: 'publication-one' });
    await rm(join(f.directory, 'image.png'));
    await expect(publisher.submit(f.handoff)).resolves.toEqual({ outcome: 'already-accepted', publicationId: 'publication-one' });
    expect(f.requests).toEqual(['POST', 'PUT', 'POST']);
    expect(f.submissions).toEqual([JSON.stringify(f.handoff.envelope), JSON.stringify(f.handoff.envelope)]);
  });

  it('keeps pending work and never reads media after intake capacity rejection', async () => {
    const f = await fixture();
    await rm(join(f.directory, 'image.png'));
    f.transport.fetch = async (_url, init) => {
      f.requests.push(init?.method ?? 'GET');
      await new Response(init?.body).text();
      return Response.json({ code: 'FREE_TIER_BUDGET_EXHAUSTED' }, { status: 429 });
    };
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    const staged = await publisher.prepare(f.handoff);
    await expect(publisher.submit(f.handoff)).resolves.toMatchObject({ outcome: 'retry-later', code: 'FREE_TIER_BUDGET_EXHAUSTED' });
    expect(f.requests).toEqual(['POST']);
    expect(await readdir(join(staged.path, '..'))).toContain(`${staged.id}.json`);
  });

  it('recovers remote acceptance with a fresh outbox and deleted media', async () => {
    const f = await fixture();
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    await publisher.submit(f.handoff);
    await rm(join(f.directory, 'image.png'));
    f.requests.length = 0;
    const fresh = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'fresh-outbox'), transport: f.transport });
    await expect(fresh.submit(f.handoff)).resolves.toEqual({ outcome: 'accepted', publicationId: 'publication-one' });
    await expect(fresh.submit(f.handoff)).resolves.toEqual({ outcome: 'already-accepted', publicationId: 'publication-one' });
    expect(f.requests).toEqual(['POST']);
  });

  it.each([
    [409, { code: 'PUBLICATION_CONFLICT' }],
    [409, { code: 'artifact_not_ready' }],
    [409, null],
    [500, { code: 'ARTIFACT_NOT_READY' }],
    [202, {}],
  ])('never uploads after unrecognized intake response %s %j', async (status, payload) => {
    const f = await fixture();
    f.transport.fetch = (_url, init) => {
      f.requests.push(init?.method ?? 'GET');
      return Promise.resolve(Response.json(payload, { status }));
    };
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    await expect(publisher.submit(f.handoff)).rejects.toThrow();
    expect(f.requests).toEqual(['POST']);
  });

  it('preserves pending work without resubmitting when upload capacity is rejected', async () => {
    const f = await fixture();
    f.transport.fetch = (_url, init) => {
      f.requests.push(init?.method ?? 'GET');
      return Promise.resolve(init?.method === 'POST'
        ? Response.json({ code: 'ARTIFACT_NOT_READY' }, { status: 409 })
        : Response.json({ code: 'FREE_TIER_BUDGET_EXHAUSTED' }, { status: 429 }));
    };
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    const staged = await publisher.prepare(f.handoff);
    await expect(publisher.submit(f.handoff)).resolves.toMatchObject({ outcome: 'retry-later', uploaded: 0 });
    expect(f.requests).toEqual(['POST', 'PUT']);
    expect(await readdir(join(staged.path, '..'))).toContain(`${staged.id}.json`);
  });

  it('rejects changed local bytes after the probe without uploading or accepting them', async () => {
    const f = await fixture();
    await writeFile(join(f.directory, 'image.png'), 'changed-image!');
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    await expect(publisher.submit(f.handoff)).rejects.toThrow();
    expect(f.requests).toEqual(['POST']);
  });

  it('retains a lost intake response for an idempotent retry', async () => {
    const f = await fixture();
    const request = f.transport.fetch;
    f.transport.fetch = async (url, init) => {
      if (init?.method === 'POST') throw new Error('connection lost');
      return request(url, init);
    };
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    const staged = await publisher.prepare(f.handoff);
    await expect(publisher.submit(f.handoff)).rejects.toThrow('connection lost');
    expect(await readdir(join(staged.path, '..'))).toContain(`${staged.id}.json`);
  });

  it('rejects changed content using an existing identity before sending it', async () => {
    const f = await fixture();
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: f.transport });
    await publisher.prepare(f.handoff);
    const changed = structuredClone(f.handoff);
    changed.envelope.canonical.title = 'Different copy';
    await expect(publisher.submit(changed)).rejects.toThrow('different content');
    expect(f.requests).toEqual([]);
  });

  it('requires explicit secure transport only for submission', async () => {
    const f = await fixture();
    const publisher = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox') });
    await publisher.prepare(f.handoff);
    await expect(publisher.submit(f.handoff)).rejects.toThrow('credentials');
    const insecure = api.createPlatformPublisher({ outboxDirectory: join(f.directory, 'outbox'), transport: { ...f.transport, baseUrl: 'http://publisher.example' } });
    await expect(insecure.submit(f.handoff)).rejects.toThrow('HTTPS origin');
    expect(f.requests).toEqual([]);
  });
});
