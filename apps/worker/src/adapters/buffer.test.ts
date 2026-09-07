import { describe, expect, it, vi } from 'vitest';
import { createBufferAdapter, type BufferContext } from './buffer.js';
import { parseAdapterConfigs } from '../adapter-configs.js';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createD1DeliveryStore } from '../delivery/d1-delivery-store.js';
import { acquireD1Lease } from '../delivery/d1-lease.js';
import { consumeDelivery, type ConsumerDependencies } from '../delivery/consume.js';
import { reconcileDelivery } from '../reconciliation/reconcile-delivery.js';
import { createAdapterRegistry } from '../registry.js';

const context: BufferContext = {
  tenant: 'trebla', deliveryId: 'buffer-1', idempotencyKey: 'approved:linkedin', operation: 'publish',
  config: { apiKey: 'private-test-key', channelId: 'a'.repeat(24), accountUrl: 'https://www.linkedin.com/company/treblahq', mediaRepository: 'treblahq/social-publisher-media', mediaPathPrefix: 'media/' },
  payload: { type: 'social.post', text: 'Exact approved text', artifactIds: [] },
  providerOptions: { channel: 'linkedin', mode: 'shareNow', aiAssisted: true }, artifacts: [],
};
const channel = { id: context.config.channelId, service: 'linkedin', externalLink: context.config.accountUrl, isDisconnected: false, isLocked: false, allowedActions: ['manageUpdates'] };
const post = { id: 'post-123', channelId: channel.id, status: 'sending', externalLink: null };
function setup() {
  const request = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { query: string };
    if (body.query.includes('query BufferChannel')) return Promise.resolve(Response.json({ data: { channel } }));
    if (body.query.includes('mutation')) return Promise.resolve(Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post } } }));
    return Promise.resolve(Response.json({ data: { post: { ...post, status: 'sent', externalLink: 'https://www.linkedin.com/feed/update/123' } } }));
  });
  return { request, adapter: createBufferAdapter({ request, now: () => new Date('2026-09-07T12:00:00.000Z') }) };
}
describe('Buffer LinkedIn', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  async function withImage(): Promise<BufferContext> {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    return { ...context, payload: { ...context.payload, artifactIds: ['image'] }, providerOptions: { ...context.providerOptions, imageAltText: ['Approved alt text'] }, artifacts: [{ id: 'image', storage: 'external', sha256: hash, byteSize: bytes.length, mediaType: 'image/png', locator: `https://raw.githubusercontent.com/treblahq/social-publisher-media/${'a'.repeat(40)}/media/image.png` }] };
  }
  it('verifies pinned owned image bytes without credentials before submitting exact approved media', async () => {
    const { request, adapter } = setup();
    const original = required(request.getMockImplementation());
    request.mockImplementation((url, init) => url.startsWith('https://raw.') ? Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'image/png' } })) : original(url, init));
    const candidate = await withImage();
    await adapter.deliver(candidate);
    const media = required(request.mock.calls.find(([url]) => url.startsWith('https://raw.')));
    expect(new Headers(media[1].headers).get('Authorization')).toBeNull();
    expect(media[1].redirect).toBe('error');
    const mutation = required(request.mock.calls.find(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation')));
    expect(json(mutation[1].body as string).variables.input.assets).toEqual([{ image: { url: required(candidate.artifacts[0]).locator, metadata: { altText: 'Approved alt text' } } }]);
  });
  it.each(['valid', 'last-invalid', 'aggregate'])('verifies an ordered carousel entirely before mutation: %s', async kind => {
    const { request, adapter } = setup();
    const candidate = await withImage();
    const first = required(candidate.artifacts[0]);
    const second = { ...first, id: 'second', locator: first.locator.replace('image.png', 'second.png') };
    candidate.artifacts = [first, second];
    candidate.payload.artifactIds = ['image', 'second'];
    required(candidate.providerOptions).imageAltText = ['First', 'Second'];
    if (kind === 'aggregate') { first.byteSize = 3 * 1024 * 1024; second.byteSize = first.byteSize; }
    const original = required(request.getMockImplementation());
    request.mockImplementation((url, init) => url.startsWith('https://raw.') ? Promise.resolve(new Response(kind === 'last-invalid' && url.endsWith('second.png') ? new Uint8Array(bytes.length) : bytes, { headers: { 'Content-Type': 'image/png' } })) : original(url, init));
    if (kind === 'valid') {
      await adapter.deliver(candidate);
      const mutation = required(request.mock.calls.find(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation')));
      expect(json(mutation[1].body as string).variables.input.assets.map((asset: { image: { metadata: { altText: string } } }) => asset.image.metadata.altText)).toEqual(['First', 'Second']);
    } else {
      await expect(adapter.deliver(candidate)).rejects.toMatchObject({ category: 'terminal' });
      expect(request.mock.calls.some(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation'))).toBe(false);
      if (kind === 'aggregate') expect(request).not.toHaveBeenCalled();
    }
  });
  it('persists processing ID through SQLite and fresh consumer reconciliation without a second effect', async () => {
    const { request, adapter } = setup();
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync('apps/worker/migrations/0001_core.sql', 'utf8'));
    sqlite.exec("INSERT INTO tenants (id,name,enabled) VALUES ('trebla','Trebla',1); INSERT INTO producer_clients (id,tenant_id,name,enabled,secret_hash) VALUES ('client','trebla','Publisher',1,'hash');");
    const envelope = { schemaVersion: 1, identity: { tenant: 'trebla', sourceType: 'campaign', sourceId: 'campaign', revision: '1', idempotencyKey: 'approved' }, canonical: { title: 'Approved', language: 'pt-BR' }, artifacts: [], deliveries: [{ id: 'linkedin', adapter: 'social.buffer', operation: 'publish', required: true, payload: context.payload, providerOptions: context.providerOptions }] };
    sqlite.prepare("INSERT INTO publications (id,tenant_id,producer_client_id,source_type,source_id,revision,idempotency_key,envelope_json,state) VALUES ('publication','trebla','client','campaign','campaign','1','approved',?,'accepted')").run(JSON.stringify(envelope));
    sqlite.prepare("INSERT INTO deliveries (id,tenant_id,publication_id,delivery_key,adapter,operation,required,payload_json,state) VALUES ('delivery','trebla','publication','linkedin','social.buffer','publish',1,?,'ready')").run(JSON.stringify(context.payload));
    const executions = new WeakMap<object, () => { meta: { changes: number } }>();
    const database = {
      prepare(sql: string) {
        let bindings: SQLInputValue[] = [];
        const statement = { bind(...values: unknown[]) { bindings = values as SQLInputValue[]; return this; },
          first: <T>() => Promise.resolve((sqlite.prepare(sql).get(...bindings) ?? null) as T | null),
          all: () => Promise.resolve({ results: sqlite.prepare(sql).all(...bindings) }) };
        executions.set(statement, () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) } }));
        return statement;
      },
      batch(statements: object[]) {
        sqlite.exec('BEGIN');
        try { const result = statements.map(statement => required(executions.get(statement))()); sqlite.exec('COMMIT'); return Promise.resolve(result); }
        catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      },
    };
    try {
      const store = createD1DeliveryStore(database, () => context.config);
      const dependencies: ConsumerDependencies = { registry: createAdapterRegistry([adapter], ['social.buffer']), states: store, now: () => new Date('2026-09-07T12:00:00.000Z'), leases: { acquire: (tenant, id, now, duration, purpose, snapshot) => acquireD1Lease(database, tenant, id, now, duration, purpose, snapshot), commit: () => Promise.resolve() } };
      await consumeDelivery(required(await store.load('trebla', 'delivery')), dependencies);
      const fresh = await createD1DeliveryStore(database, () => context.config).load('trebla', 'delivery');
      expect(fresh).toMatchObject({ state: 'processing', receipt: { remoteId: post.id, metadata: { status: 'processing' } } });
      await reconcileDelivery(required(fresh), dependencies);
      expect(sqlite.prepare('SELECT state FROM deliveries').get()).toMatchObject({ state: 'verified' });
      expect(request.mock.calls.filter(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation'))).toHaveLength(1);
      expect((await store.load('trebla', 'delivery'))?.receipt).toMatchObject({ remoteId: post.id, remoteUrl: 'https://www.linkedin.com/feed/update/123', metadata: { status: 'sent' } });
    } finally { sqlite.close(); }
  });
  it.each(['mutable', 'unowned', 'hash', 'size', 'mime', 'oversize', 'redirect', 'signature'])('rejects unsafe media before mutation: %s', async kind => {
    const { request, adapter } = setup();
    const candidate = await withImage();
    const artifact = required(candidate.artifacts[0]);
    if (kind === 'mutable') artifact.locator = artifact.locator.replace('a'.repeat(40), 'main');
    if (kind === 'unowned') artifact.locator = artifact.locator.replace('treblahq/', 'other/');
    if (kind === 'hash') artifact.sha256 = 'b'.repeat(64);
    if (kind === 'size') artifact.byteSize++;
    if (kind === 'oversize') artifact.byteSize = 20_000_000;
    const original = required(request.getMockImplementation());
    request.mockImplementation((url, init) => url.startsWith('https://raw.') ? Promise.resolve(new Response(kind === 'signature' ? new Uint8Array(bytes.length) : bytes, { status: kind === 'redirect' ? 302 : 200, headers: { 'Content-Type': kind === 'mime' ? 'text/html' : 'image/png' } })) : original(url, init));
    await expect(adapter.deliver(candidate)).rejects.toMatchObject({ category: 'terminal' });
    expect(request.mock.calls.filter(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation'))).toHaveLength(0);
  });
  it.each([['transport', 'retryable'], ['deadline', 'retryable'], ['429', 'rate-limited'], ['503', 'retryable']])('retries transient media %s without creating an effect until successful recovery', async (kind, category) => {
    const { request, adapter } = setup();
    const candidate = await withImage();
    const original = required(request.getMockImplementation());
    const abort = new AbortController();
    const timeout = kind === 'deadline' ? vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal) : undefined;
    request.mockImplementation((url, init) => {
      if (!url.startsWith('https://raw.')) return original(url, init);
      if (kind === 'transport') return Promise.reject(new Error('private-test-key'));
      if (kind === 'deadline') { abort.abort(); return Promise.reject(new Error('timeout')); }
      return Promise.resolve(new Response('private-test-key', { status: Number(kind) }));
    });
    try { await expect(adapter.deliver(candidate)).rejects.toMatchObject({ category }); }
    finally { timeout?.mockRestore(); }
    expect(request.mock.calls.some(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation'))).toBe(false);
    request.mockImplementation((url, init) => url.startsWith('https://raw.') ? Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'image/png' } })) : original(url, init));
    await expect(adapter.deliver(candidate)).resolves.toMatchObject({ remoteId: post.id });
    expect(request.mock.calls.filter(([, init]) => (typeof init.body === 'string' ? init.body : '').includes('mutation'))).toHaveLength(1);
  });
  it('injects only a tenant secret and rejects public keys or another tenant', () => {
    const value = JSON.stringify({ trebla: { 'social.buffer': { channelId: channel.id } } });
    expect(parseAdapterConfigs(value, undefined, undefined, '{"trebla":"private-test-key"}').trebla?.['social.buffer']?.apiKey).toBe('private-test-key');
    expect(() => parseAdapterConfigs(value, undefined, undefined, '{"other":"private-test-key"}')).toThrow('Buffer Worker secret');
    expect(() => parseAdapterConfigs('{"trebla":{"social.buffer":{"apiKey":"public"}}}', undefined)).toThrow('public configuration');
  });
  it.each(['extra-config', 'account-root', 'payload-override'])('rejects unsupported trusted configuration or approved payload fields: %s', async kind => {
    const { adapter } = setup();
    const candidate = structuredClone(context);
    if (kind === 'extra-config') Object.assign(candidate.config, { baseUrl: 'https://other.test' });
    if (kind === 'account-root') candidate.config.accountUrl = 'https://www.linkedin.com/';
    if (kind === 'payload-override') candidate.payload.channelId = 'other';
    await expect(adapter.validate(candidate)).resolves.toMatchObject({ valid: false });
  });
  it('creates once, immediately returns sanitized processing ID, then verifies exactly that ID', async () => {
    const { request, adapter } = setup();
    const receipt = await adapter.deliver(context);
    expect(receipt).toEqual({ provider: 'social.buffer', remoteId: post.id, acceptedAt: '2026-09-07T12:00:00.000Z', metadata: { status: 'processing', channelId: channel.id } });
    expect(request).toHaveBeenCalledTimes(2);
    expect(json(required(request.mock.calls[1])[1].body as string).variables.input).toEqual({ text: context.payload.text, channelId: channel.id, schedulingType: 'automatic', mode: 'shareNow', needsApproval: false, aiAssisted: true, assets: [] });
    await expect(adapter.reconcile({ ...context, receipt })).resolves.toMatchObject({ status: 'found', receipt: { remoteId: post.id, remoteUrl: 'https://www.linkedin.com/feed/update/123', metadata: { status: 'sent' } } });
    expect(json(required(request.mock.calls[2])[1].body as string).variables).toEqual({ input: { id: post.id } });
    expect(request.mock.calls.every(([url, init]) => url === 'https://api.buffer.com' && init.redirect === 'error')).toBe(true);
  });
  it('does not start a mutation after the total preflight budget expires', async () => {
    const { request, adapter } = setup();
    const abort = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abort.signal);
    request.mockImplementation(() => { abort.abort(); return Promise.resolve(Response.json({ data: { channel } })); });
    try {
      await expect(adapter.deliver(context)).rejects.toMatchObject({ category: 'retryable' });
      expect(request).toHaveBeenCalledOnce();
    } finally { timeout.mockRestore(); }
  });
  it.each([{ id: 'wrong' }, { service: 'instagram' }, { externalLink: 'https://www.linkedin.com/company/other' }, { isDisconnected: true }, { isLocked: true }, { allowedActions: [] }])('rejects untrusted channel %j before creation', async change => {
    const { request, adapter } = setup();
    request.mockResolvedValue(Response.json({ data: { channel: { ...channel, ...change } } }));
    await expect(adapter.deliver(context)).rejects.toMatchObject({ category: 'credential' });
    expect(request).toHaveBeenCalledOnce();
  });
  it.each([undefined, {}, { channel: 'instagram', mode: 'shareNow', aiAssisted: true }, { channel: 'linkedin', mode: 'shareNow' }, { ...context.providerOptions, channelId: 'other' }, { ...context.providerOptions, mode: 'scheduled' }])('rejects unapproved options %j', async providerOptions => {
    const { request, adapter } = setup();
    const candidate = { ...context };
    if (providerOptions === undefined) delete candidate.providerOptions;
    else candidate.providerOptions = providerOptions;
    await expect(adapter.validate(candidate)).resolves.toMatchObject({ valid: false });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['transport', 'invalid', 'graphql', 'http'])('never repeats an ambiguous mutation: %s', async failure => {
    const { request, adapter } = setup();
    request.mockImplementationOnce(() => Promise.resolve(Response.json({ data: { channel } }))).mockImplementationOnce(() => {
      if (failure === 'transport') return Promise.reject(new Error('private-test-key'));
      if (failure === 'invalid') return Promise.resolve(Response.json({ data: { createPost: { post: {} } } }));
      if (failure === 'graphql') return Promise.resolve(Response.json({ errors: [{ message: 'private-test-key' }] }));
      return Promise.resolve(new Response('private-test-key', { status: 503 }));
    });
    await expect(adapter.deliver(context)).rejects.toMatchObject({ category: 'ambiguous' });
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toEqual({ status: 'unknown' });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([{ status: 'sending' }, { status: 'scheduled' }, { status: 'error' }, { id: 'wrong', status: 'sent' }, { channelId: 'wrong', status: 'sent' }, { status: 'sent', externalLink: 'https://evil.test/' }])('does not verify unresolved or mismatched post %j', async change => {
    const { request, adapter } = setup();
    const receipt = await adapter.deliver(context);
    request.mockResolvedValue(Response.json({ data: { post: { ...post, ...change } } }));
    await expect(adapter.reconcile({ ...context, receipt })).resolves.toEqual({ status: 'unknown' });
  });
  it('rejects mismatched receipt identity without any read', async () => {
    const { request, adapter } = setup();
    await expect(adapter.reconcile({ ...context, receipt: { provider: 'other', remoteId: post.id, acceptedAt: '2026-09-07T12:00:00.000Z' } })).resolves.toEqual({ status: 'unknown' });
    expect(request).not.toHaveBeenCalled();
  });
});

function required<T>(value: T | null | undefined): T { if (value === undefined || value === null) throw new Error('Expected test value'); return value; }
function json(value: string): { variables: { input: { assets: { image: { metadata: { altText: string } } }[] } } } { return JSON.parse(value) as { variables: { input: { assets: { image: { metadata: { altText: string } } }[] } } }; }
