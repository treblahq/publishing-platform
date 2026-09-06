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

export interface PreHashedSignedHeadersInput extends Omit<SignedHeadersInput, 'body'> {
  bodySha256: string;
  contentType: string;
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
  return buildSignedHeadersFromHash({
    clientId: input.clientId,
    secret: input.secret,
    method: input.method,
    path: input.path,
    tenant: input.tenant,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodySha256,
    contentType: 'application/json',
  });
}

export async function buildSignedHeadersFromHash(
  input: PreHashedSignedHeadersInput,
): Promise<Record<string, string>> {
  if (!/^[a-f0-9]{64}$/u.test(input.bodySha256)) {
    throw new Error('Signed body SHA-256 must be lowercase hexadecimal');
  }
  if (input.contentType.length === 0) throw new Error('Signed content type is required');
  const signature = await signCanonicalRequest({
    method: input.method,
    path: input.path,
    tenant: input.tenant,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodySha256: input.bodySha256,
  }, input.secret);

  return {
    'content-type': input.contentType,
    'x-pub-client': input.clientId,
    'x-pub-tenant': input.tenant,
    'x-pub-timestamp': input.timestamp,
    'x-pub-nonce': input.nonce,
    'x-pub-content-sha256': input.bodySha256,
    'x-pub-signature': signature,
  };
}
