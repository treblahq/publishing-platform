import { parseWorkerBindings } from './bindings.js';
import { createD1CapacityChecker } from './capacity/d1-capacity.js';
import { createD1ProducerClientLoader } from './intake/d1-client-loader.js';
import { createD1IntakeStore } from './intake/d1-intake-store.js';
import { handlePublicationRequest } from './intake/routes.js';
import { createD1OutboxStore } from './coordinator/d1-outbox-store.js';
import { dispatchOutbox } from './coordinator/dispatch-outbox.js';
import { enqueueDueRetries } from './coordinator/d1-retry.js';
import { createOneSignalAdapter } from '@treblahq/publishing-adapter-onesignal';
import { createPagesAdapter } from '@treblahq/publishing-adapter-pages';
import { createR2WebAdapter } from '@treblahq/publishing-adapter-r2';
import { createAdapterRegistry } from './registry.js';
import { acquireD1Lease } from './delivery/d1-lease.js';
import { createD1DeliveryStore } from './delivery/d1-delivery-store.js';
import { consumeDelivery } from './delivery/consume.js';
import { handleDeliveryBatch } from './delivery/queue-handler.js';
import { createD1AttemptStore } from './delivery/d1-attempt-store.js';
import { handleAdminRequest } from './admin/routes.js';
import { createD1AdminDependencies } from './admin/d1-admin.js';
import { runD1ArtifactCleanup } from './cleanup/d1-cleanup.js';
import { runD1Reconciliation } from './reconciliation/d1-reconciliation.js';
import { reconcileDelivery } from './reconciliation/reconcile-delivery.js';
import { refreshD1CapacityUsage } from './capacity/d1-refresh.js';
import { isD1AdapterEnabled } from './delivery/d1-adapter-control.js';
import { createD1FailureRecorder } from './delivery/d1-failure-recorder.js';
import { handleD1DeadLetterBatch } from './delivery/d1-dead-letter.js';
import { parseAdapterConfigs } from './adapter-configs.js';
import { createD1R2EntityStores, find as findWebEntity } from './web/d1-entity-stores.js';
import { handleWebEntityRequest } from './web/routes.js';
import { handleArtifactUploadRequest } from './artifacts/routes.js';
import { createD1UploadStore } from './artifacts/d1-uploads.js';

type Environment = Record<string, unknown>;
type RouteHandler = (request: Request, environment: Environment) => Promise<Response>;

interface WorkerOverrides {
  publicationHandler?: RouteHandler;
  artifactHandler?: RouteHandler;
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
      if (pathname === '/v1/publications') {
        const response = await (overrides.publicationHandler ?? handleRuntimePublication)(request, environment);
        if (response.status === 202 && context) {
          context.waitUntil((overrides.scheduledHandler ?? dispatchRuntimeOutbox)(environment));
        }
        return response;
      }
      if (pathname === '/v1/artifacts') {
        return (overrides.artifactHandler ?? handleRuntimeArtifactUpload)(request, environment);
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
      context.waitUntil((overrides.scheduledHandler ?? dispatchRuntimeOutbox)(environment));
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
    const secrets = parseProducerSecrets(environment.PRODUCER_SECRETS);
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
  const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS, environment.ONESIGNAL_REST_API_KEY);
  const oneSignal = createOneSignalAdapter({ send: sendOneSignal, now: () => new Date() });
  const pages = createPagesAdapter({ request: (url, init) => fetch(url, init) });
  const r2 = createR2WebAdapter({
    stores: (tenant) => createD1R2EntityStores(database, bindings.artifacts as R2Bucket, tenant),
    request: (url, init) => fetch(url, init),
  });
  const adapters = [oneSignal, pages, r2];
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
        acquire: (tenant, id, now, duration, purpose) => acquireD1Lease(database, tenant, id, now, duration, purpose),
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

async function dispatchRuntimeOutbox(environment: Environment): Promise<number> {
  const bindings = parseWorkerBindings(environment);
  const database = bindings.ledger as D1Database;
  const queue = bindings.deliveryQueue as Queue;
  await refreshD1CapacityUsage(database, 25);
  await reconcileRuntimeDeliveries(environment, database, bindings.enabledAdapters);
  await enqueueDueRetries(database, 25);
  await runD1ArtifactCleanup(database, bindings.artifacts as R2Bucket, 25);
  return dispatchOutbox(createD1OutboxStore(database), {
    send: async (message) => { await queue.send(message); },
  }, 50);
}

async function reconcileRuntimeDeliveries(
  environment: Environment,
  database: D1Database,
  enabledAdapters: readonly string[],
): Promise<number> {
  const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS, environment.ONESIGNAL_REST_API_KEY);
  const adapters = [
    createOneSignalAdapter({ send: sendOneSignal, now: () => new Date() }),
    createPagesAdapter({ request: (url, init) => fetch(url, init) }),
    createR2WebAdapter({
      stores: (tenant) => createD1R2EntityStores(database, (parseWorkerBindings(environment).artifacts as R2Bucket), tenant),
      request: (url, init) => fetch(url, init),
    }),
  ];
  const registry = createAdapterRegistry(adapters, enabledAdapters);
  const store = createD1DeliveryStore(database, (adapter, tenant) => configs[tenant]?.[adapter] ?? {});
  return runD1Reconciliation(database, 25, async ({ tenantId, deliveryId }) => {
    const delivery = await store.load(tenantId, deliveryId);
    if (delivery === null) return;
    const tenantRegistry = await isD1AdapterEnabled(database, tenantId, delivery.adapter)
      ? registry
      : createAdapterRegistry(adapters, enabledAdapters.filter((name) => name !== delivery.adapter));
    await reconcileDelivery(delivery, {
      registry: tenantRegistry,
      leases: {
        acquire: (tenant, id, now, duration, purpose) => acquireD1Lease(database, tenant, id, now, duration, purpose),
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
    const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS, environment.ONESIGNAL_REST_API_KEY);
    const config = configs[tenant]?.['web.r2'] as { shellBaseUrl?: unknown; canonicalBaseUrl?: unknown } | undefined;
    if (typeof config?.shellBaseUrl !== 'string' || typeof config.canonicalBaseUrl !== 'string') {
      return new Response('Not found', { status: 404 });
    }
    const stores = createD1R2EntityStores(database, bindings.artifacts as R2Bucket, tenant);
    return await handleWebEntityRequest(request, {
      find: (kind, id) => findWebEntity(database, tenant, kind, id),
      getObject: (key) => stores.objects.get(key),
      getShell: (kind) => fetch(new URL(kind === 'job' ? '/jobs/' : kind === 'author' ? '/route-indexes/authors/' : '/route-indexes/communities/', config.shellBaseUrl as string)),
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
    const secrets = parseProducerSecrets(environment.PRODUCER_SECRETS);
    return await handlePublicationRequest(request, {
      now: () => new Date(),
      loadClient: createD1ProducerClientLoader(database, (clientId) => secrets[clientId]),
      capacity: createD1CapacityChecker(database, bindings.capacity),
      store: createD1IntakeStore(database),
    });
  } catch {
    return Response.json({ code: 'SERVICE_UNAVAILABLE' }, { status: 503 });
  }
}

function parseProducerSecrets(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Producer secrets are required');
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid producer secrets');
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, secret]) => typeof secret !== 'string' || secret.length === 0)) {
    throw new Error('Invalid producer secret');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export default createWorker();
