import {
  MAX_ENVELOPE_BYTES,
  validatePublicationEnvelope,
  type PublicationEnvelope,
} from '@trebla/publishing';

import { acceptPublication, PublicationConflictError, type AtomicIntakeStore, type IntakeCapacity } from './accept-publication.js';
import { authenticateRequest, type ProducerClientLoader } from './authenticate.js';

export interface PublicationRouteDependencies {
  now(): Date;
  loadClient: ProducerClientLoader;
  capacity(tenant: string, envelope: unknown): Promise<IntakeCapacity>;
  artifactsReady(tenant: string, envelope: PublicationEnvelope): Promise<boolean>;
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

  let envelope: PublicationEnvelope;
  try {
    envelope = validatePublicationEnvelope(JSON.parse(body));
  } catch {
    return Response.json({ code: 'INVALID_JSON' }, { status: 400 });
  }

  if (envelope.identity.tenant !== principal.tenant) {
    return Response.json({ code: 'INVALID_PUBLICATION' }, { status: 400 });
  }
  try {
    const existing = await dependencies.store.findByIdempotencyKey({ principal, envelope });
    if (existing !== null) return Response.json({ publicationId: existing }, { status: 202 });
    if (!await dependencies.artifactsReady(principal.tenant, envelope)) {
      return Response.json({ code: 'ARTIFACT_NOT_READY' }, { status: 409 });
    }
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
  } catch (error) {
    if (error instanceof PublicationConflictError) {
      return Response.json({ code: 'PUBLICATION_CONFLICT' }, { status: 409 });
    }
    if (isDurableCapacityRejection(error)) {
      const now = dependencies.now();
      const retry = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      return Response.json({
        outcome: 'retry-later', code: 'FREE_TIER_BUDGET_EXHAUSTED', publicationAccepted: false,
        retryAfter: retry.toISOString(),
      }, { status: 429, headers: { 'retry-after': retry.toUTCString() } });
    }
    return Response.json({ code: 'INVALID_PUBLICATION' }, { status: 400 });
  }
}

function isDurableCapacityRejection(error: unknown): boolean {
  // D1 may wrap the SQLite trigger error. Do not classify arbitrary DB errors as capacity denial.
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    if (error.message.includes('free-tier capacity reservation rejected')) return true;
    error = error.cause;
  }
  return false;
}
