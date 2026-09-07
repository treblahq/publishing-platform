import { describe, expect, it, vi } from 'vitest';
import { createMastodonAdapter, type MastodonContext } from './mastodon.js';

const context: MastodonContext = {
  tenant: 'openings', deliveryId: 'mastodon-1', idempotencyKey: 'openings:job:42:mastodon',
  operation: 'publish', config: { baseUrl: 'https://mastodon.social', accessToken: 'test-only' },
  payload: { type: 'social.post', text: 'A new job https://openings.dev/jobs/42',
    canonicalUrl: 'https://openings.dev/jobs/42', language: 'en', artifactIds: [] }, artifacts: [],
};
const status = { id: '123', url: 'https://mastodon.social/@openings/123',
  account: { id: 'account-1' }, content: '<p><a href="https://openings.dev/jobs/42">job</a></p>' };

function setup(postResponse: () => Response | Promise<Response> = () => Response.json(status)) {
  let posted = false;
  const request = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/verify_credentials')) return Response.json({ id: 'account-1' });
    if (url.includes('/accounts/account-1/statuses')) return Response.json(posted ? [status] : []);
    if (init.method === 'POST') { posted = true; return postResponse(); }
    return Response.json(status);
  });
  return { request, adapter: createMastodonAdapter({ request, now: () => new Date('2026-09-07T05:00:00Z') }) };
}

describe('Mastodon delivery', () => {
  it('uses the authenticated account, emits a stable key and reconciles duplicates', async () => {
    const { request, adapter } = setup();
    const first = await adapter.deliver(context);
    const second = await adapter.deliver(context);
    expect(first.remoteId).toBe('123');
    expect(second.remoteId).toBe(first.remoteId);
    const posts = request.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(new Headers(posts[0]?.[1].headers).get('Idempotency-Key')).toMatch(/^[a-f0-9]{64}$/);
    expect(new URLSearchParams(posts[0]?.[1].body as string).get('status')).toBe(context.payload.text);
    expect(JSON.stringify(first)).not.toContain('test-only');
    await expect(adapter.reconcile({ ...context, receipt: first })).resolves.toMatchObject({ status: 'found' });
  });
  it('classifies a lost POST response as ambiguous and finds the effect without posting again', async () => {
    const { adapter, request } = setup(() => { throw new Error('transport lost'); });
    await expect(adapter.deliver(context)).rejects.toMatchObject({ category: 'ambiguous' });
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toMatchObject({ status: 'found' });
    expect(request.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
  it('does not treat a bounded search with no result as proof of absence', async () => {
    const { adapter } = setup();
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toEqual({ status: 'unknown' });
  });
  it.each([[401, 'credential'], [429, 'rate-limited'], [503, 'ambiguous'], [422, 'terminal']])(
    'classifies HTTP %s without leaking provider response bodies', async (code, category) => {
      const { adapter } = setup(() => new Response('sensitive provider body', {
        status: code, headers: { 'retry-after': '60' },
      }));
      await expect(adapter.deliver(context)).rejects.toMatchObject({ category });
    });
  it('rejects unsupported media and unsafe origins before any request', async () => {
    const { adapter, request } = setup();
    await expect(adapter.deliver({ ...context, config: { ...context.config, baseUrl: 'http://mastodon.social' } }))
      .rejects.toMatchObject({ category: 'terminal' });
    await expect(adapter.validate({ ...context, payload: { ...context.payload, artifactIds: ['image'] } }))
      .resolves.toMatchObject({ valid: false });
    expect(request).not.toHaveBeenCalled();
  });
  it('does not accept a matching URL posted by another account during reconciliation', async () => {
    const { adapter, request } = setup();
    request.mockImplementation((url) => Promise.resolve(url.endsWith('/verify_credentials')
      ? Response.json({ id: 'account-1' })
      : Response.json([{ ...status, account: { id: 'different' } }])));
    await expect(adapter.reconcile({ ...context, receipt: undefined })).resolves.toEqual({ status: 'unknown' });
  });
});
