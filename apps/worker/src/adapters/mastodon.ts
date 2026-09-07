import { DeliveryError, type DeliveryErrorCategory, type DeliveryReceipt } from '@trebla/publishing';
import type { AdapterContext, DeliveryAdapter } from '@trebla/publishing-adapter-kit';

interface MastodonConfig { baseUrl: string; accessToken: string }
interface MastodonPayload extends Record<string, unknown> {
  type: 'social.post'; text: string; canonicalUrl: string; language: string; artifactIds: string[];
}
export type MastodonContext = AdapterContext<MastodonConfig, MastodonPayload>;
interface Dependencies { request?: (url: string, init: RequestInit) => Promise<Response>; now?: () => Date }

// Text/link publishing matches the existing Openings Mastodon format. Media
// attachments need a separate ingestion contract and are deliberately rejected.
export function createMastodonAdapter(dependencies: Dependencies = {}): DeliveryAdapter<MastodonConfig, MastodonPayload> {
  const request = dependencies.request ?? ((url, init) => fetch(url, init));
  const now = dependencies.now ?? (() => new Date());

  async function call(config: MastodonConfig, path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${config.accessToken}`);
      response = await request(`${new URL(config.baseUrl).origin}${path}`, {
        ...init, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers,
      });
    } catch {
      throw failure('MASTODON_TRANSPORT', init.method === 'POST' ? 'ambiguous' : 'retryable');
    }
    if (!response.ok) {
      const category = response.status === 429 ? 'rate-limited'
        : [401, 403].includes(response.status) ? 'credential'
          : response.status >= 500 ? (init.method === 'POST' ? 'ambiguous' : 'retryable') : 'terminal';
      const retryAfter = response.headers.get('retry-after');
      throw new DeliveryError({ code: `MASTODON_HTTP_${String(response.status)}`, category,
        message: `Mastodon returned HTTP ${String(response.status)}`,
        ...(retryAfter ? { retryAfter } : {}),
      });
    }
    try { return await response.json(); } catch {
      throw failure('MASTODON_RESPONSE_INVALID', init.method === 'POST' ? 'ambiguous' : 'retryable');
    }
  }

  async function accountId(config: MastodonConfig): Promise<string> {
    const account = record(await call(config, '/api/v1/accounts/verify_credentials'));
    if (typeof account?.id !== 'string' || !account.id) throw failure('MASTODON_ACCOUNT_INVALID', 'credential');
    return account.id;
  }

  async function findRecent(config: MastodonConfig, account: string, canonicalUrl: string): Promise<DeliveryReceipt | undefined> {
    const statuses = await call(config, `/api/v1/accounts/${encodeURIComponent(account)}/statuses?limit=40&exclude_replies=true&exclude_reblogs=true`);
    if (!Array.isArray(statuses)) throw failure('MASTODON_SEARCH_INVALID', 'retryable');
    const existing: unknown = (statuses as unknown[]).find(value => matches(value, account, canonicalUrl));
    return existing === undefined ? undefined : receipt(existing);
  }

  function receipt(value: unknown): DeliveryReceipt {
    const status = record(value);
    if (typeof status?.id !== 'string' || !status.id || !httpsUrl(status.url)) {
      throw failure('MASTODON_RECEIPT_INVALID', 'ambiguous');
    }
    return { provider: 'social.mastodon', remoteId: status.id,
      remoteUrl: status.url as string, acceptedAt: now().toISOString() };
  }

  return {
    manifest: { contractVersion: 1, name: 'social.mastodon', channels: ['social.post'], operations: ['publish'],
      // Mastodon retains idempotency keys for at most one hour. We cannot
      // promise indefinite provider idempotency to the durable queue.
      capabilities: { providerIdempotency: false, reconciliation: true, asynchronousIngestion: false } },
    validate: context => Promise.resolve(validate(context)),
    deliver: async context => {
      if (!validate(context).valid) throw failure('MASTODON_INVALID_PAYLOAD', 'terminal');
      const account = await accountId(context.config);
      const existing = await findRecent(context.config, account, context.payload.canonicalUrl);
      if (existing) return existing;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context.idempotencyKey));
      const key = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const created = await call(context.config, '/api/v1/statuses', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Idempotency-Key': key },
        body: new URLSearchParams({ status: context.payload.text, language: context.payload.language, visibility: 'public' }).toString(),
      });
      return receipt(created);
    },
    reconcile: async context => {
      const candidate = { ...context, payload: context.payload as MastodonPayload };
      if (!validate(candidate).valid) return { status: 'unknown' };
      const account = await accountId(context.config);
      if (context.receipt?.provider === 'social.mastodon' && context.receipt.remoteId) {
        try {
          const status = await call(context.config, `/api/v1/statuses/${encodeURIComponent(context.receipt.remoteId)}`);
          if (matches(status, account, candidate.payload.canonicalUrl)) return { status: 'found', receipt: receipt(status) };
        } catch (error) {
          if (!(error instanceof DeliveryError) || error.code !== 'MASTODON_HTTP_404') throw error;
        }
      }
      const existing = await findRecent(context.config, account, candidate.payload.canonicalUrl);
      // A post can fall outside the recent 40. Missing search results never
      // authorize another public effect after an ambiguous transport failure.
      return existing ? { status: 'found', receipt: existing } : { status: 'unknown' };
    },
  };
}

function validate(context: MastodonContext) {
  const issues: string[] = [];
  const config = record(context.config);
  const payload = record(context.payload);
  if (!config || !httpsUrl(config.baseUrl) || new URL(config.baseUrl as string).pathname !== '/') issues.push('HTTPS origin required');
  if (typeof config?.accessToken !== 'string' || !config.accessToken.trim()) issues.push('Access token required');
  if (context.operation !== 'publish' || payload?.type !== 'social.post') issues.push('Unsupported operation');
  if (typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 500) issues.push('Text required within 500 characters');
  if (!httpsUrl(payload?.canonicalUrl) || typeof payload?.text !== 'string'
    || !payload.text.split(/\s+/u).includes(String(payload.canonicalUrl))) issues.push('Exact canonical link required in text');
  if (typeof payload?.language !== 'string' || !/^[a-z]{2}$/u.test(payload.language)) issues.push('ISO language required');
  if (!Array.isArray(payload?.artifactIds) || payload.artifactIds.length !== 0 || context.artifacts.length !== 0) issues.push('Media attachments are unsupported');
  return issues.length ? { valid: false as const, issues } : { valid: true as const };
}

function matches(value: unknown, accountId: string, url: string): boolean {
  const status = record(value);
  if (record(status?.account)?.id !== accountId || status?.reblog != null) return false;
  if (record(status?.card)?.url === url) return true;
  if (typeof status?.content !== 'string') return false;
  return [...status.content.matchAll(/href=(['"])(.*?)\1/giu)].some(match =>
    match[2]?.replace(/&amp;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'") === url);
}
function httpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search; }
  catch { return false; }
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function failure(code: string, category: DeliveryErrorCategory) {
  return new DeliveryError({ code, category, message: `Mastodon delivery failed (${code})` });
}
