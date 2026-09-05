import { sha256Hex, signCanonicalRequest } from '@treblahq/publishing-client';

export interface ProducerClientCredential {
  id: string;
  tenant: string;
  enabled: boolean;
  secret: string;
}

export interface AuthenticationInput {
  method: string;
  path: string;
  body: string;
  headers: Readonly<Record<string, string>>;
  now: Date;
}

export interface AuthenticatedProducer {
  clientId: string;
  tenant: string;
  nonce: string;
  timestamp: string;
}

export type ProducerClientLoader = (
  clientId: string,
) => Promise<ProducerClientCredential | null>;

const MAXIMUM_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function authenticateRequest(
  input: AuthenticationInput,
  loadClient: ProducerClientLoader,
): Promise<AuthenticatedProducer> {
  const clientId = requiredHeader(input.headers, 'x-pub-client');
  const tenant = requiredHeader(input.headers, 'x-pub-tenant');
  const timestamp = requiredHeader(input.headers, 'x-pub-timestamp');
  const nonce = requiredHeader(input.headers, 'x-pub-nonce');
  const contentHash = requiredHeader(input.headers, 'x-pub-content-sha256');
  const suppliedSignature = requiredHeader(input.headers, 'x-pub-signature');

  const client = await loadClient(clientId);
  if (!client) throw new Error('Unknown producer client');
  if (!client.enabled) throw new Error('Producer client is disabled');
  if (client.tenant !== tenant) throw new Error('Producer client tenant mismatch');

  const requestTime = Date.parse(timestamp);
  if (!Number.isFinite(requestTime) || Math.abs(input.now.getTime() - requestTime) > MAXIMUM_CLOCK_SKEW_MS) {
    throw new Error('Producer timestamp is outside the accepted window');
  }

  const calculatedHash = await sha256Hex(input.body);
  if (!constantTimeEqual(contentHash, calculatedHash)) throw new Error('Request body hash mismatch');

  const calculatedSignature = await signCanonicalRequest({
    method: input.method,
    path: input.path,
    tenant,
    timestamp,
    nonce,
    bodySha256: contentHash,
  }, client.secret);
  if (!constantTimeEqual(suppliedSignature, calculatedSignature)) {
    throw new Error('Request signature mismatch');
  }

  return { clientId, tenant, nonce, timestamp };
}

function requiredHeader(headers: Readonly<Record<string, string>>, name: string): string {
  const value = headers[name];
  if (!value) throw new Error(`Missing signed header: ${name}`);
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
