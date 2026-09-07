import { DeliveryError, type ArtifactReference, type DeliveryErrorCategory } from '@trebla/publishing';
import type { AdapterContext, DeliveryAdapter } from '@trebla/publishing-adapter-kit';

interface BufferConfig { apiKey: string; channelId: string; accountUrl: string; mediaRepository: string; mediaPathPrefix: string }
export type BufferContext = AdapterContext<BufferConfig>;
interface Dependencies { request?: (url: string, init: RequestInit) => Promise<Response>; now?: () => Date }

const CHANNEL = 'query BufferChannel($input: ChannelInput!) { channel(input: $input) { id service externalLink isDisconnected isLocked allowedActions } }';
const CREATE = 'mutation BufferCreate($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { id channelId status externalLink } } ... on MutationError { message } } }';
const POST = 'query BufferPost($input: PostInput!) { post(input: $input) { id channelId status externalLink } }';
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export function createBufferAdapter(dependencies: Dependencies = {}): DeliveryAdapter<BufferConfig> {
  const request = dependencies.request ?? ((url, init) => fetch(url, init));
  const now = dependencies.now ?? (() => new Date());
  async function graphql(config: BufferConfig, query: string, input: Record<string, unknown>, deadline?: AbortSignal) {
    const category = query === CREATE ? 'ambiguous' : 'retryable';
    try {
      const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(deadline ? [deadline] : [])]);
      const response = await request('https://api.buffer.com', { method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: { input } }) });
      if (!response.ok || response.redirected) throw failure('BUFFER_HTTP_FAILED', category);
      const envelope = record(await response.json());
      const data = record(envelope?.data);
      if (!envelope || envelope.errors !== undefined || !data) throw failure('BUFFER_RESPONSE_INVALID', category);
      return data;
    } catch { throw failure('BUFFER_REQUEST_FAILED', category); }
  }
  function receipt(id: string, channelId: string, acceptedAt: string, remoteUrl?: string) {
    return { provider: 'social.buffer', remoteId: id, acceptedAt,
      ...(remoteUrl ? { remoteUrl } : {}), metadata: { status: remoteUrl ? 'sent' : 'processing', channelId } };
  }
  async function verifyMedia(artifact: ArtifactReference, deadline: AbortSignal) {
    try {
      deadline.throwIfAborted();
      const response = await request(artifact.locator, { method: 'GET', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20_000), deadline]) });
      if (!response.ok) throw failure('BUFFER_MEDIA_HTTP_FAILED', response.status === 429 ? 'rate-limited' : response.status >= 500 || response.status === 408 ? 'retryable' : 'terminal');
      if (response.redirected || response.headers.get('content-type')?.split(';')[0]?.trim() !== artifact.mediaType) throw failure('BUFFER_MEDIA_INVALID', 'terminal');
      const length = response.headers.get('content-length');
      if (length !== null && Number(length) !== artifact.byteSize) throw failure('BUFFER_MEDIA_INVALID', 'terminal');
      const reader = response.body?.getReader();
      if (!reader) throw failure('BUFFER_MEDIA_INVALID', 'terminal');
      const bytes = new Uint8Array(artifact.byteSize);
      let total = 0;
      try {
        let chunk = await reader.read();
        while (!chunk.done) {
          total += chunk.value.byteLength;
          deadline.throwIfAborted();
          if (total > artifact.byteSize) throw failure('BUFFER_MEDIA_INVALID', 'terminal');
          bytes.set(chunk.value, total - chunk.value.byteLength);
          chunk = await reader.read();
        }
      } finally { await reader.cancel(); }
      if (total !== artifact.byteSize || !imageSignature(bytes, artifact.mediaType)) throw failure('BUFFER_MEDIA_INVALID', 'terminal');
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== artifact.sha256) throw failure('BUFFER_MEDIA_INVALID', 'terminal');
    } catch (error) {
      if (error instanceof DeliveryError) throw error;
      // No provider mutation has happened yet; transient public reads can retry.
      throw failure('BUFFER_MEDIA_TRANSPORT', 'retryable');
    }
  }
  return {
    manifest: { contractVersion: 1, name: 'social.buffer', channels: ['social.post'], operations: ['publish'], capabilities: { providerIdempotency: false, reconciliation: true, asynchronousIngestion: true } },
    validate: context => Promise.resolve(validate(context)),
    deliver: async context => {
      if (!validate(context).valid) throw failure('BUFFER_INVALID_PAYLOAD', 'terminal');
      // Leave time to durably commit the accepted ID inside the default 60s lease.
      const deadline = AbortSignal.timeout(40_000);
      const channel = record((await graphql(context.config, CHANNEL, { id: context.config.channelId }, deadline)).channel);
      if (!channel || channel.id !== context.config.channelId || channel.service !== 'linkedin'
        || channel.externalLink !== context.config.accountUrl || channel.isDisconnected !== false || channel.isLocked !== false
        || !Array.isArray(channel.allowedActions) || !channel.allowedActions.includes('manageUpdates')) throw failure('BUFFER_CHANNEL_MISMATCH', 'credential');
      for (const artifact of context.artifacts) await verifyMedia(artifact, deadline);
      const altText = context.providerOptions?.imageAltText as string[] | undefined;
      const assets = context.artifacts.map((artifact, index) => ({ image: { url: artifact.locator, metadata: { altText: altText?.[index] } } }));
      if (deadline.aborted) throw failure('BUFFER_PREFLIGHT_TIMEOUT', 'retryable');
      const created = record((await graphql(context.config, CREATE, { text: context.payload.text, channelId: context.config.channelId,
        schedulingType: 'automatic', mode: 'shareNow', needsApproval: false, aiAssisted: context.providerOptions?.aiAssisted, assets }, deadline)).createPost);
      const post = record(created?.post);
      if (created?.__typename !== 'PostActionSuccess' || !validPost(post, context.config.channelId)) throw failure('BUFFER_CREATE_INVALID', 'ambiguous');
      return receipt(post.id, context.config.channelId, now().toISOString());
    },
    reconcile: async context => {
      const previous = context.receipt;
      if (!validate(context).valid || previous?.provider !== 'social.buffer' || !safeId(previous.remoteId)
        || previous.metadata?.channelId !== context.config.channelId) return { status: 'unknown' };
      const post = record((await graphql(context.config, POST, { id: previous.remoteId })).post);
      if (!validPost(post, context.config.channelId) || post.id !== previous.remoteId || post.status !== 'sent' || !linkedInUrl(post.externalLink)) return { status: 'unknown' };
      return { status: 'found', receipt: receipt(previous.remoteId, context.config.channelId, previous.acceptedAt, post.externalLink as string) };
    },
  };
}
function validate(context: BufferContext) {
  const c = record(context.config), p = record(context.payload), o = record(context.providerOptions);
  const valid = c && typeof c.apiKey === 'string' && c.apiKey.trim().length > 0 && typeof c.channelId === 'string' && /^[a-f0-9]{24}$/u.test(c.channelId)
    && Object.keys(c).every(key => ['apiKey', 'channelId', 'accountUrl', 'mediaRepository', 'mediaPathPrefix'].includes(key))
    && linkedInUrl(c.accountUrl) && /^\/(?:company|in)\/[\w-]+\/?$/u.test(new URL(c.accountUrl as string).pathname)
    && typeof c.mediaRepository === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(c.mediaRepository)
    && typeof c.mediaPathPrefix === 'string' && /^(?:[\w-]+\/)+$/u.test(c.mediaPathPrefix)
    && context.operation === 'publish' && p?.type === 'social.post' && typeof p.text === 'string' && p.text.trim().length > 0 && p.text.length <= 3000
    && Object.keys(p).every(key => ['type', 'text', 'artifactIds', 'canonicalUrl', 'language'].includes(key))
    && Array.isArray(p.artifactIds) && p.artifactIds.length === context.artifacts.length && context.artifacts.length <= 20
    && new Set(p.artifactIds).size === p.artifactIds.length
    && context.artifacts.every((artifact, index) => artifact.id === (p.artifactIds as unknown[])[index] && validMedia(artifact, context.config))
    && context.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0) <= MAX_MEDIA_BYTES
    && o?.channel === 'linkedin' && o.mode === 'shareNow' && typeof o.aiAssisted === 'boolean'
    && (context.artifacts.length === 0 ? o.imageAltText === undefined : Array.isArray(o.imageAltText) && o.imageAltText.length === context.artifacts.length && o.imageAltText.every(text => typeof text === 'string' && text.trim().length > 0 && text.length <= 1000))
    && Object.keys(o).every(key => ['channel', 'mode', 'aiAssisted', 'imageAltText'].includes(key));
  return valid ? { valid: true as const } : { valid: false as const, issues: ['Unsupported Buffer configuration, payload, or options'] };
}
function validMedia(artifact: ArtifactReference, config: BufferConfig): boolean {
  if (artifact.storage !== 'external' || !['image/png', 'image/jpeg'].includes(artifact.mediaType) || !Number.isSafeInteger(artifact.byteSize)
    || artifact.byteSize <= 0 || artifact.byteSize > MAX_MEDIA_BYTES || !/^[a-f0-9]{64}$/u.test(artifact.sha256)) return false;
  try {
    const url = new URL(artifact.locator);
    const prefix = `/${config.mediaRepository}/`;
    const path = url.pathname.slice(prefix.length);
    return url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com' && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.startsWith(prefix) && /^[a-f0-9]{40}\//u.test(path) && path.slice(41).startsWith(config.mediaPathPrefix)
      && !url.pathname.includes('%') && !artifact.locator.includes('..') && !artifact.locator.includes('\\')
      && (artifact.mediaType === 'image/png' ? path.endsWith('.png') : /\.jpe?g$/u.test(path));
  } catch { return false; }
}
function imageSignature(bytes: Uint8Array, mediaType: string): boolean {
  return mediaType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value); }
function validPost(post: Record<string, unknown> | undefined, channelId: string): post is Record<string, unknown> & { id: string } {
  return post !== undefined && safeId(post.id) && post.channelId === channelId && typeof post.status === 'string'
    && ['draft', 'error', 'needs_approval', 'scheduled', 'sending', 'sent'].includes(post.status);
}
function linkedInUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && ['linkedin.com', 'www.linkedin.com'].includes(url.hostname) && !url.port && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}
function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function failure(code: string, category: DeliveryErrorCategory) { return new DeliveryError({ code, category, message: `Buffer delivery failed (${code})` }); }
