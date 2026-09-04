import { signCanonicalRequest } from './sign.js';

export interface SignedHeadersInput {
  clientId: string;
  secret: string;
  method: string;
  path: string;
  tenant: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function buildSignedHeaders(
  input: SignedHeadersInput,
): Promise<Record<string, string>> {
  const bodySha256 = await sha256Hex(input.body);
  const signature = await signCanonicalRequest({
    method: input.method,
    path: input.path,
    tenant: input.tenant,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodySha256,
  }, input.secret);

  return {
    'content-type': 'application/json',
    'x-pub-client': input.clientId,
    'x-pub-tenant': input.tenant,
    'x-pub-timestamp': input.timestamp,
    'x-pub-nonce': input.nonce,
    'x-pub-content-sha256': bodySha256,
    'x-pub-signature': signature,
  };
}
