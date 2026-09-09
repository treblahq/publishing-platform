import { parseWorkerBindings } from './bindings.js';
import { createD1CapacityChecker } from './capacity/d1-capacity.js';
import { createD1ProducerClientLoader } from './intake/d1-client-loader.js';
import { createD1IntakeStore } from './intake/d1-intake-store.js';
import { handlePublicationRequest } from './intake/routes.js';
import { createD1OutboxStore } from './coordinator/d1-outbox-store.js';
import { dispatchOutbox } from './coordinator/dispatch-outbox.js';
import { enqueueDueRetries } from './coordinator/d1-retry.js';
import { createOneSignalAdapter } from '@trebla/publishing-adapter-onesignal';
import { createPagesAdapter } from '@trebla/publishing-adapter-pages';
import { createR2WebAdapter } from '@trebla/publishing-adapter-r2';
import { createSocialShadowAdapter } from '@trebla/publishing-adapter-shadow';
import { createMastodonAdapter } from './adapters/mastodon.js';
import { createBufferAdapter } from './adapters/buffer.js';
import { loadProducerSecrets } from './intake/producer-secrets.js';
import { handlePublicationStatusRequest } from './intake/status.js';
import { createAdapterRegistry } from './registry.js';
import { acquireD1Lease } from './delivery/d1-lease.js';
import { createD1DeliveryStore, StoredDeliveryIntegrityError } from './delivery/d1-delivery-store.js';
import { consumeDelivery } from './delivery/consume.js';
import { handleDeliveryBatch } from './delivery/queue-handler.js';
import { createD1AttemptStore } from './delivery/d1-attempt-store.js';
import { handleAdminRequest } from './admin/routes.js';
import { createD1AdminDependencies } from './admin/d1-admin.js';
import { runD1ArtifactCleanup, runD1UploadCleanup } from './cleanup/d1-cleanup.js';
import { runD1Reconciliation } from './reconciliation/d1-reconciliation.js';
import { reconcileDelivery } from './reconciliation/reconcile-delivery.js';
import { refreshD1CapacityUsage } from './capacity/d1-refresh.js';
import { isD1AdapterEnabled } from './delivery/d1-adapter-control.js';
import { createD1FailureRecorder } from './delivery/d1-failure-recorder.js';
import { handleD1DeadLetterBatch } from './delivery/d1-dead-letter.js';
import { parseAdapterConfigs } from './adapter-configs.js';
import { createD1R2EntityStores, find as findWebEntity } from './web/d1-entity-stores.js';
import { fetchWebShell } from './web/shell.js';
import { handleWebEntityRequest } from './web/routes.js';
import { handleArtifactUploadRequest } from './artifacts/routes.js';
import { createD1UploadStore } from './artifacts/d1-uploads.js';
import { verifyTemporaryArtifacts } from './artifacts/verify-uploads.js';
import { handleRuntimePublicMedia } from './artifacts/public-media-runtime.js';

type Environment = Record<string, unknown>;
type RouteHandler = (request: Request, environment: Environment) => Promise<Response>;

interface WorkerOverrides {
  publicationHandler?: RouteHandler;
  artifactHandler?: RouteHandler;
  outboxHandler?: (environment: Environment) => Promise<number>;
  scheduledHandler?: (environment: Environment) => Promise<number>;
  queueHandler?: (batch: MessageBatch, environment: Environment) => Promise<void>;
  adminHandler?: RouteHandler;
}

export function createWorker(overrides: WorkerOverrides = {}) {
  return {
    async fetch(request: Request, environment: Environment, context?: ExecutionContext): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (request.method === 'GET' && pathname === '/health/live') {
        return Response.json({ status: 'live' });
      }
      if (pathname === '/media' || pathname.startsWith('/media/')) {
        return handleRuntimePublicMedia(request, environment);
      }
      if (pathname === '/v1/publications') {
        const response = await (overrides.publicationHandler ?? handleRuntimePublication)(request, environment);
        if (response.status === 202 && context) {
          context.waitUntil((overrides.outboxHandler ?? dispatchRuntimeOutbox)(environment));
        }
        return response;
      }
      if (pathname === '/v1/artifacts') {
        return (overrides.artifactHandler ?? handleRuntimeArtifactUpload)(request, environment);
      }
      if (request.method === 'GET' && pathname.startsWith('/v1/publications/')) {
        return handleRuntimePublicationStatus(request, environment);
      }
      if (request.method === 'GET' && pathname.startsWith('/web/')) {
        return handleRuntimeWebEntity(request, environment);
      }
      if (pathname.startsWith('/admin/')) {
        return (overrides.adminHandler ?? handleRuntimeAdmin)(request, environment);
      }
      return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
    },
    scheduled(
      _controller: ScheduledController,
      environment: Environment,
      context: ExecutionContext,
    ): void {
      context.waitUntil((overrides.scheduledHandler ?? runRuntimeMaintenance)(environment));
    },
    async queue(batch: MessageBatch, environment: Environment): Promise<void> {
      await (overrides.queueHandler ?? consumeRuntimeBatch)(batch, environment);
    },
  };
}

async function handleRuntimeArtifactUpload(request: Request, environment: Environment): Promise<Response> {
  try {
    const bindings = parseWorkerBindings(environment);
    const database = bindings.ledger as D1Database;
    const secrets = loadProducerSecrets(environment.PRODUCER_SECRETS, environment.SOCIAL_PRODUCER_SECRETS);
    return await handleArtifactUploadRequest(request, {
      now: () => new Date(),
      loadClient: createD1ProducerClientLoader(database, (clientId) => secrets[clientId]),
      uploads: createD1UploadStore(database),
      bucket: bindings.artifacts as R2Bucket,
    });
  } catch {
    return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}

async function handleRuntimePublicationStatus(request: Request, environment: Environment): Promise<Response> {
  try {
    const database = parseWorkerBindings(environment).ledger as D1Database;
    const secrets = loadProducerSecrets(environment.PRODUCER_SECRETS, environment.SOCIAL_PRODUCER_SECRETS);
    return await handlePublicationStatusRequest(request, {
      now: () => new Date(),
      loadClient: createD1ProducerClientLoader(database, id => secrets[id]),
      loadStatus: async (tenant, clientId, publicationId) => {
        const publication = await database.prepare(`SELECT id FROM publications
          WHERE id = ? AND tenant_id = ? AND producer_client_id = ? LIMIT 1`)
          .bind(publicationId, tenant, clientId).first();
        if (!publication) return null;
        const result = await database.prepare(`SELECT d.delivery_key AS id, d.adapter, d.state,
          r.provider, r.remote_id AS remoteId, json_extract(r.receipt_json, '$.remoteUrl') AS remoteUrl
          FROM deliveries d LEFT JOIN receipts r ON r.delivery_id = d.id AND r.tenant_id = d.tenant_id
          WHERE d.publication_id = ? AND d.tenant_id = ? ORDER BY d.delivery_key LIMIT 100`)
          .bind(publicationId, tenant).all();
        return { publicationId, deliveries: result.results };
      },
    });
  } catch { return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 }); }
}

async function handleRuntimeAdmin(request: Request, environment: Environment): Promise<Response> {
  try {
    const bindings = parseWorkerBindings(environment);
    if (typeof environment.ADMIN_TOKEN !== 'string') throw new Error('Admin token is required');
    return await handleAdminRequest(
      request,
      createD1AdminDependencies(bindings.ledger as D1Database, environment.ADMIN_TOKEN),
    );
  } catch {
    return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}

async function consumeRuntimeBatch(batch: MessageBatch, environment: Environment): Promise<void> {
  const bindings = parseWorkerBindings(environment);
  const database = bindings.ledger as D1Database;
  if (batch.queue.includes('dlq')) {
    await handleD1DeadLetterBatch(database, batch.messages);
    return;
  }
  const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS, environment.ONESIGNAL_REST_API_KEY, environment.MASTODON_ACCESS_TOKENS, environment.BUFFER_API_KEYS);
  const oneSignal = createOneSignalAdapter({ send: sendOneSignal, now: () => new Date() });
  const pages = createPagesAdapter({ request: (url, init) => fetch(url, init) });
  const r2 = createR2WebAdapter({
    stores: (tenant) => createD1R2EntityStores(database, bindings.artifacts as R2Bucket, tenant),
    request: (url, init) => fetch(url, init),
  });
  const adapters = [oneSignal, pages, r2, createSocialShadowAdapter(), createMastodonAdapter(), createBufferAdapter()];
  const registry = createAdapterRegistry(adapters, bindings.enabledAdapters);
  const store = createD1DeliveryStore(database, (adapter, tenant) => configs[tenant]?.[adapter] ?? {});
  await handleDeliveryBatch(batch.messages, async ({ tenantId, deliveryId }) => {
    const delivery = await store.load(tenantId, deliveryId);
    if (delivery === null) throw new Error('Delivery not found');
    const tenantRegistry = await isD1AdapterEnabled(database, tenantId, delivery.adapter)
      ? registry
      : createAdapterRegistry(adapters, bindings.enabledAdapters.filter((name) => name !== delivery.adapter));
    await consumeDelivery(delivery, {
      registry: tenantRegistry,
      leases: {
        acquire: (tenant, id, now, duration, purpose, snapshot) => acquireD1Lease(database, tenant, id, now, duration, purpose, snapshot),
        commit: () => Promise.resolve(),
      },
      states: store,
      attempts: createD1AttemptStore(database),
      failures: createD1FailureRecorder(database),
      now: () => new Date(),
    });
  });
}

async function sendOneSignal(request: { url: string; headers: Readonly<Record<string, string>>; body: Readonly<Record<string, unknown>> }) {
  const response = await fetch(request.url, {
    method: 'POST', headers: request.headers, body: JSON.stringify(request.body),
  });
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  const retryAfter = response.headers.get('retry-after');
  return { status: response.status, body, ...(retryAfter === null ? {} : { retryAfter }) };
}

async function runRuntimeMaintenance(environment: Environment): Promise<number> {
  const bindings = parseWorkerBindings(environment);
  const database = bindings.ledger as D1Database;
  await refreshD1CapacityUsage(database, 25);
  await reconcileRuntimeDeliveries(environment, database, bindings.enabledAdapters);
  await enqueueDueRetries(database, 25);
  await runD1UploadCleanup(database, bindings.artifacts as R2Bucket, 25);
  await runD1ArtifactCleanup(database, bindings.artifacts as R2Bucket, 25);
  return dispatchRuntimeOutbox(environment, 50);
}

async function dispatchRuntimeOutbox(environment: Environment, limit = 1): Promise<number> {
  const bindings = parseWorkerBindings(environment);
  const database = bindings.ledger as D1Database;
  const queue = bindings.deliveryQueue as Queue;
  // HTTP intake only nudges the queue; scheduled maintenance drains the backlog.
  return dispatchOutbox(createD1OutboxStore(database), {
    send: async (message) => { await queue.send(message); },
  }, limit);
}

export async function reconcileRuntimeDeliveries(
  environment: Environment,
  database: D1Database,
  enabledAdapters: readonly string[],
): Promise<number> {
  const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS, environment.ONESIGNAL_REST_API_KEY, environment.MASTODON_ACCESS_TOKENS, environment.BUFFER_API_KEYS);
  const adapters = [
    createOneSignalAdapter({ send: sendOneSignal, now: () => new Date() }),
    createPagesAdapter({ request: (url, init) => fetch(url, init) }),
    createR2WebAdapter({
      stores: (tenant) => createD1R2EntityStores(database, (parseWorkerBindings(environment).artifacts as R2Bucket), tenant),
      request: (url, init) => fetch(url, init),
    }),
    createSocialShadowAdapter(),
    createMastodonAdapter(),
    createBufferAdapter(),
  ];
  const registry = createAdapterRegistry(adapters, enabledAdapters);
  const store = createD1DeliveryStore(database, (adapter, tenant) => configs[tenant]?.[adapter] ?? {});
  return runD1Reconciliation(database, 25, async ({ tenantId, deliveryId }) => {
    let delivery;
    try {
      delivery = await store.load(tenantId, deliveryId);
    } catch (error) {
      if (!(error instanceof StoredDeliveryIntegrityError)) throw error;
      const lease = await acquireD1Lease(database, tenantId, deliveryId, new Date(), 60_000, 'reconciliation');
      if (!lease.acquired) throw new Error('Cannot quarantine delivery without a current lease');
      // Keep the original receipt and artifacts for review; quarantine only under the current tenant-scoped lease.
      await store.commit(tenantId, deliveryId, lease.token, 'needs_attention');
      return;
    }
    if (delivery === null) return;
    const tenantRegistry = await isD1AdapterEnabled(database, tenantId, delivery.adapter)
      ? registry
      : createAdapterRegistry(adapters, enabledAdapters.filter((name) => name !== delivery.adapter));
    await reconcileDelivery(delivery, {
      registry: tenantRegistry,
      leases: {
        acquire: (tenant, id, now, duration, purpose, snapshot) => acquireD1Lease(database, tenant, id, now, duration, purpose, snapshot),
        commit: () => Promise.resolve(),
      },
      states: store,
      now: () => new Date(),
    });
  });
}

async function handleRuntimeWebEntity(request: Request, environment: Environment): Promise<Response> {
  try {
    const bindings = parseWorkerBindings(environment);
    const database = bindings.ledger as D1Database;
    const tenant = new URL(request.url).pathname.split('/').filter(Boolean)[1];
    if (!tenant) return new Response('Not found', { status: 404 });
    const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS, environment.ONESIGNAL_REST_API_KEY, environment.MASTODON_ACCESS_TOKENS, environment.BUFFER_API_KEYS);
    const config = configs[tenant]?.['web.r2'] as { shellBaseUrl?: unknown; canonicalBaseUrl?: unknown } | undefined;
    if (typeof config?.shellBaseUrl !== 'string' || typeof config.canonicalBaseUrl !== 'string') {
      return new Response('Not found', { status: 404 });
    }
    const stores = createD1R2EntityStores(database, bindings.artifacts as R2Bucket, tenant);
    return await handleWebEntityRequest(request, {
      find: (kind, id) => findWebEntity(database, tenant, kind, id),
      objectExists: async (key) => Boolean(await stores.objects.head(key)),
      getShell: (kind) => fetchWebShell(kind, config.shellBaseUrl as string),
      canonicalBaseUrl: config.canonicalBaseUrl,
    });
  } catch {
    return new Response('Service unavailable', { status: 503 });
  }
}

async function handleRuntimePublication(request: Request, environment: Environment): Promise<Response> {
  try {
    const bindings = parseWorkerBindings(environment);
    const database = bindings.ledger as D1Database;
    const secrets = loadProducerSecrets(environment.PRODUCER_SECRETS, environment.SOCIAL_PRODUCER_SECRETS);
    return await handlePublicationRequest(request, {
      now: () => new Date(),
      loadClient: createD1ProducerClientLoader(database, (clientId) => secrets[clientId]),
      capacity: createD1CapacityChecker(database, bindings.capacity),
      artifactsReady: (tenant, envelope) => verifyTemporaryArtifacts(
        database,
        bindings.artifacts as R2Bucket,
        tenant,
        envelope,
      ),
      store: createD1IntakeStore(database),
    });
  } catch {
    return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}

export default createWorker();
