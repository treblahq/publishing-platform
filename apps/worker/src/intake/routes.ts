import { MAX_ENVELOPE_BYTES } from '@treblahq/publishing-contracts';

import { acceptPublication, type AtomicIntakeStore, type IntakeCapacity } from './accept-publication.js';
import { authenticateRequest, type ProducerClientLoader } from './authenticate.js';

export interface PublicationRouteDependencies {
  now(): Date;
  loadClient: ProducerClientLoader;
  capacity(tenant: string, envelope: unknown): Promise<IntakeCapacity>;
  store: AtomicIntakeStore;
}

export async function handlePublicationRequest(
  request: Request,
  dependencies: PublicationRouteDependencies,
): Promise<Response> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/publications') {
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_ENVELOPE_BYTES) {
    return Response.json({ code: 'BODY_TOO_LARGE' }, { status: 413 });
  }

  let principal;
  try {
    principal = await authenticateRequest({
      method: request.method,
      path: new URL(request.url).pathname,
      body,
      headers: Object.fromEntries(request.headers.entries()),
      now: dependencies.now(),
    }, dependencies.loadClient);
  } catch {
    return Response.json({ code: 'UNAUTHORIZED' }, { status: 401 });
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(body);
  } catch {
    return Response.json({ code: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    const result = await acceptPublication({
      envelope,
      principal,
      store: dependencies.store,
      capacity: await dependencies.capacity(principal.tenant, envelope),
    });
    if (result.outcome === 'retry-later') {
      return Response.json(result, {
        status: 429,
        headers: { 'retry-after': result.retryAfter },
      });
    }
    return Response.json({ publicationId: result.publicationId }, { status: 202 });
  } catch {
    return Response.json({ code: 'INVALID_PUBLICATION' }, { status: 400 });
  }
}
