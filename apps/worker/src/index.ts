import { parseWorkerBindings } from './bindings.js';
import { createD1CapacityChecker } from './capacity/d1-capacity.js';
import { createD1ProducerClientLoader } from './intake/d1-client-loader.js';
import { createD1IntakeStore } from './intake/d1-intake-store.js';
import { handlePublicationRequest } from './intake/routes.js';
import { createD1OutboxStore } from './coordinator/d1-outbox-store.js';
import { dispatchOutbox } from './coordinator/dispatch-outbox.js';

type Environment = Record<string, unknown>;
type RouteHandler = (request: Request, environment: Environment) => Promise<Response>;

interface WorkerOverrides {
  publicationHandler?: RouteHandler;
  scheduledHandler?: (environment: Environment) => Promise<number>;
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
      return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
    },
    scheduled(
      _controller: ScheduledController,
      environment: Environment,
      context: ExecutionContext,
    ): void {
      context.waitUntil((overrides.scheduledHandler ?? dispatchRuntimeOutbox)(environment));
    },
  };
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

export default createWorker();
