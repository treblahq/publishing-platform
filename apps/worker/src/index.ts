import { parseWorkerBindings } from './bindings.js';
import { createD1CapacityChecker } from './capacity/d1-capacity.js';
import { createD1ProducerClientLoader } from './intake/d1-client-loader.js';
import { createD1IntakeStore } from './intake/d1-intake-store.js';
import { handlePublicationRequest } from './intake/routes.js';
import { createD1OutboxStore } from './coordinator/d1-outbox-store.js';
import { dispatchOutbox } from './coordinator/dispatch-outbox.js';
import { createOneSignalAdapter } from '@treblahq/publishing-adapter-onesignal';
import { createAdapterRegistry } from './registry.js';
import { acquireD1Lease } from './delivery/d1-lease.js';
import { createD1DeliveryStore } from './delivery/d1-delivery-store.js';
import { consumeDelivery } from './delivery/consume.js';
import { handleDeliveryBatch } from './delivery/queue-handler.js';
import { handleAdminRequest } from './admin/routes.js';
import { createD1AdminDependencies } from './admin/d1-admin.js';

type Environment = Record<string, unknown>;
type RouteHandler = (request: Request, environment: Environment) => Promise<Response>;

interface WorkerOverrides {
  publicationHandler?: RouteHandler;
  scheduledHandler?: (environment: Environment) => Promise<number>;
  queueHandler?: (batch: MessageBatch, environment: Environment) => Promise<void>;
  adminHandler?: RouteHandler;
}

export function createWorker(overrides: WorkerOverrides = {}) {
  return {
    async fetch(request: Request, environment: Environment): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (request.method === 'GET' && pathname === '/health/live') {
        return Response.json({ status: 'live' });
      }
      if (pathname === '/v1/publications') {
        return (overrides.publicationHandler ?? handleRuntimePublication)(request, environment);
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
  const configs = parseAdapterConfigs(environment.ADAPTER_CONFIGS);
  const oneSignal = createOneSignalAdapter({ send: sendOneSignal, now: () => new Date() });
  const registry = createAdapterRegistry([oneSignal], bindings.enabledAdapters);
  const store = createD1DeliveryStore(database, (adapter, tenant) => configs[tenant]?.[adapter] ?? {});
  await handleDeliveryBatch(batch.messages, async ({ tenantId, deliveryId }) => {
    const delivery = await store.load(tenantId, deliveryId);
    if (delivery === null) throw new Error('Delivery not found');
    await consumeDelivery(delivery, {
      registry,
      leases: {
        acquire: (tenant, id, now, duration) => acquireD1Lease(database, tenant, id, now, duration),
        commit: () => Promise.resolve(),
      },
      states: store,
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
  return dispatchOutbox(createD1OutboxStore(database), {
    send: async (message) => { await queue.send(message); },
  }, 50);
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

function parseAdapterConfigs(value: unknown): Record<string, Record<string, unknown>> {
  if (typeof value !== 'string' || value.length === 0) return {};
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid adapter configs');
  return parsed as Record<string, Record<string, unknown>>;
}

export default createWorker();
