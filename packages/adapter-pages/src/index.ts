import type { DeliveryAdapter } from '@treblahq/publishing-adapter-kit';
import { DeliveryError } from '@treblahq/publishing-contracts';

export interface PagesConfig { baseUrl: string }
export interface PagesPayload extends Record<string, unknown> { type: 'web.page'; route: string }

interface Dependencies {
  request(url: string, init: RequestInit): Promise<Response>;
  now?: () => Date;
}

export function createPagesAdapter(dependencies: Dependencies): DeliveryAdapter<PagesConfig, PagesPayload> {
  const now = dependencies.now ?? (() => new Date());
  return {
    manifest: {
      contractVersion: 1,
      name: 'web.pages',
      channels: ['web.page'],
      operations: ['publish'],
      capabilities: { providerIdempotency: true, reconciliation: true, asynchronousIngestion: false },
    },
    validate: ({ config, payload }) => Promise.resolve(validate(config, payload)),
    deliver: async ({ config, payload }) => {
      const result = validate(config, payload);
      if (!result.valid) throw new DeliveryError({ code: 'PAGES_INVALID_ROUTE', category: 'terminal', message: result.issues.join('; ') });
      const url = pageUrl(config, payload);
      const response = await requestPage(dependencies, url);
      if (!response.ok) throw new DeliveryError({
        code: 'PAGES_NOT_READY', category: 'retryable', message: 'Pages route is not ready',
      });
      return { provider: 'web.pages', remoteId: url, remoteUrl: url, acceptedAt: now().toISOString() };
    },
    reconcile: async ({ config, payload }) => {
      const response = await requestPage(dependencies, pageUrl(config, payload));
      if (response.status === 404) return { status: 'absent' };
      if (!response.ok) return { status: 'unknown' };
      const url = pageUrl(config, payload);
      return {
        status: 'found',
        receipt: { provider: 'web.pages', remoteId: url, remoteUrl: url, acceptedAt: now().toISOString() },
      };
    },
  };
}

async function requestPage(dependencies: Dependencies, url: string): Promise<Response> {
  try {
    return await dependencies.request(url, { method: 'GET', redirect: 'follow' });
  } catch {
    throw new DeliveryError({ code: 'PAGES_TRANSPORT', category: 'retryable', message: 'Pages verification transport failed' });
  }
}

function validate(config: PagesConfig, payload: Record<string, unknown>) {
  const issues: string[] = [];
  try {
    if (new URL(config.baseUrl).protocol !== 'https:') issues.push('Pages base URL must use HTTPS');
  } catch { issues.push('Pages base URL is invalid'); }
  if (typeof payload.route !== 'string' || !payload.route.startsWith('/') || payload.route.startsWith('//')) {
    issues.push('Pages route must be absolute');
  }
  return issues.length === 0 ? { valid: true as const } : { valid: false as const, issues };
}

function pageUrl(config: PagesConfig, payload: Record<string, unknown>): string {
  if (typeof payload.route !== 'string') throw new Error('Pages route is required');
  return new URL(payload.route, config.baseUrl).toString();
}
