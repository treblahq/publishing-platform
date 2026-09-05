import type { DeliveryAdapter } from '@trebla/publishing-adapter-kit';
import { DeliveryError, validateWebEntityRevision, type WebEntityRevision } from '@trebla/publishing-contracts';

import { stageAndActivateEntity, type EntityStores } from './activate.js';

export interface R2WebConfig {
  publicBaseUrl: string;
  canonicalBaseUrl: string;
}

export interface R2WebPayload extends Record<string, unknown> {
  type: 'web.page';
  entity: WebEntityRevision;
}

interface Dependencies {
  stores: EntityStores | ((tenant: string) => EntityStores);
  request(url: string, init: RequestInit): Promise<Response>;
  now?: () => Date;
}

export function createR2WebAdapter(
  dependencies: Dependencies,
): DeliveryAdapter<R2WebConfig, R2WebPayload> {
  const now = dependencies.now ?? (() => new Date());
  return {
    manifest: {
      contractVersion: 1,
      name: 'web.r2',
      channels: ['web.page'],
      operations: ['publish'],
      capabilities: { providerIdempotency: true, reconciliation: true, asynchronousIngestion: false },
    },
    validate: ({ tenant, config, payload }) => Promise.resolve(validate(tenant, config, payload)),
    deliver: async ({ tenant, config, payload }) => {
      const validation = validate(tenant, config, payload);
      if (!validation.valid) throw new DeliveryError({
        code: 'R2_INVALID_ENTITY', category: 'terminal', message: validation.issues.join('; '),
      });
      const stores = resolveStores(dependencies, tenant);
      const active = await stageAndActivateEntity(payload.entity, stores);
      const url = new URL(payload.entity.canonicalPath, config.publicBaseUrl).toString();
      for (let probe = 0; probe < 2; probe += 1) {
        if (!await verifyPublicRoute(dependencies, url, config, payload.entity)) {
          throw new DeliveryError({
            code: 'R2_PUBLIC_ROUTE_NOT_READY',
            category: 'retryable',
            message: 'Activated R2 entity is not verified on its public route',
          });
        }
      }
      return receipt(tenant, active.kind, active.id, active.revision, url, now());
    },
    reconcile: async ({ tenant, config, payload }) => {
      let entity: WebEntityRevision;
      try { entity = validateWebEntityRevision(payload.entity); } catch { return { status: 'absent' }; }
      const active = await resolveStores(dependencies, tenant).manifests.find(entity.kind, entity.id);
      if (!active || active.revision !== entity.revision || active.contentSha256 !== entity.contentSha256) {
        return { status: 'absent' };
      }
      const url = new URL(entity.canonicalPath, config.publicBaseUrl).toString();
      if (!await verifyPublicRoute(dependencies, url, config, entity)) return { status: 'unknown' };
      return { status: 'found', receipt: receipt(tenant, active.kind, active.id, active.revision, url, now()) };
    },
  };
}

function resolveStores(dependencies: Dependencies, tenant: string): EntityStores {
  return typeof dependencies.stores === 'function' ? dependencies.stores(tenant) : dependencies.stores;
}

function validate(tenant: string, config: R2WebConfig, payload: Record<string, unknown>) {
  const issues: string[] = [];
  for (const [label, value] of [['public', config.publicBaseUrl], ['canonical', config.canonicalBaseUrl]] as const) {
    try { if (new URL(value).protocol !== 'https:') issues.push(`${label} base URL must use HTTPS`); }
    catch { issues.push(`${label} base URL is invalid`); }
  }
  if (payload.type !== 'web.page' || typeof payload.entity !== 'object' || payload.entity === null) {
    issues.push('R2 web entity is required');
  } else {
    try {
      if (validateWebEntityRevision(payload.entity).tenant !== tenant) {
        issues.push('R2 web entity tenant does not match delivery tenant');
      }
    } catch { issues.push('R2 web entity is invalid'); }
  }
  return issues.length === 0 ? { valid: true as const } : { valid: false as const, issues };
}

async function verifyPublicRoute(
  dependencies: Dependencies,
  url: string,
  config: R2WebConfig,
  entity: WebEntityRevision,
): Promise<boolean> {
  let response: Response;
  try { response = await dependencies.request(url, { method: 'GET', redirect: 'follow' }); }
  catch { return false; }
  if (!response.ok) return false;
  const html = await response.text();
  const canonicalUrl = new URL(entity.canonicalPath, config.canonicalBaseUrl).toString();
  return html.includes(escapeHtml(entity.title)) && html.includes(escapeHtml(canonicalUrl));
}

function receipt(tenant: string, kind: string, id: string, revision: string, url: string, at: Date) {
  return {
    provider: 'web.r2', remoteId: `${tenant}:${kind}:${id}:${revision}`,
    remoteUrl: url, acceptedAt: at.toISOString(),
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export { stageAndActivateEntity } from './activate.js';
export type {
  ActiveManifest, ActiveManifestStore, EntityObjectStore, EntityStores,
} from './activate.js';
