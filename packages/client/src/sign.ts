export interface CanonicalRequestInput {
  method: string;
  path: string;
  tenant: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}

export function canonicalRequest(input: CanonicalRequestInput): string {
  const fields = [
    input.method.toUpperCase(),
    input.path,
    input.tenant,
    input.timestamp,
    input.nonce,
    input.bodySha256,
  ];
  if (fields.some((field) => field.includes('\n') || field.includes('\r'))) {
    throw new Error('Canonical request fields cannot contain line breaks');
  }
  return fields.join('\n');
}

export async function signCanonicalRequest(
  input: CanonicalRequestInput,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(canonicalRequest(input)));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
