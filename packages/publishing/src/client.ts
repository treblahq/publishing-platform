import {
  DeliveryError,
  validatePublicationEnvelope,
  type PublicationEnvelope,
} from '@trebla/publishing-contracts';

import { buildSignedHeaders } from './headers.js';

export interface PublishingClientOptions {
  baseUrl: string;
  clientId: string;
  secret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  nonce?: () => string;
}

export type SubmissionResult =
  | { outcome: 'accepted'; publicationId: string }
  | { outcome: 'retry-later'; code: string; retryAfter: string | undefined };

export interface PublishingClient {
  submit(envelope: PublicationEnvelope): Promise<SubmissionResult>;
}

export function createPublishingClient(options: PublishingClientOptions): PublishingClient {
  const request = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => crypto.randomUUID());
  const baseUrl = options.baseUrl.replace(/\/+$/u, '');
  const path = '/v1/publications';

  return {
    async submit(envelope): Promise<SubmissionResult> {
      validatePublicationEnvelope(envelope);
      const body = JSON.stringify(envelope);
      const headers = await buildSignedHeaders({
        clientId: options.clientId,
        secret: options.secret,
        method: 'POST',
        path,
        tenant: envelope.identity.tenant,
        timestamp: now().toISOString(),
        nonce: nonce(),
        body,
      });
      const response = await request(`${baseUrl}${path}`, { method: 'POST', headers, body });

      if (response.status === 429) {
        const payload = await readRecord(response);
        return {
          outcome: 'retry-later',
          code: typeof payload.code === 'string' ? payload.code : 'INTAKE_RATE_LIMITED',
          retryAfter: typeof payload.retryAfter === 'string'
            ? payload.retryAfter
            : response.headers.get('retry-after') ?? undefined,
        };
      }

      if (!response.ok) {
        throw new DeliveryError({
          code: 'INTAKE_REQUEST_FAILED',
          category: response.status >= 500 ? 'retryable' : 'terminal',
          message: `Publishing intake returned HTTP ${String(response.status)}`,
        });
      }

      const payload = await readRecord(response);
      if (typeof payload.publicationId !== 'string' || payload.publicationId.length === 0) {
        throw new DeliveryError({
          code: 'INTAKE_RESPONSE_MALFORMED',
          category: 'ambiguous',
          message: 'Publishing intake returned no publication ID',
        });
      }
      return { outcome: 'accepted', publicationId: payload.publicationId };
    },
  };
}

async function readRecord(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Publishing intake response must be an object');
  }
  return value as Record<string, unknown>;
}
