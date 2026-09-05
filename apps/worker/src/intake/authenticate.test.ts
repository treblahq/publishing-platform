import { describe, expect, it } from 'vitest';

import { buildSignedHeaders } from '@trebla/publishing-client';

import * as authentication from './authenticate.js';

const body = JSON.stringify({ schemaVersion: 1 });
const timestamp = '2026-09-04T15:00:00.000Z';

async function signedHeaders(overrides: Record<string, string> = {}) {
  return {
    ...await buildSignedHeaders({
      clientId: 'client-1',
      secret: 'test-secret',
      method: 'POST',
      path: '/v1/publications',
      tenant: 'openings',
      timestamp,
      nonce: 'nonce-1',
      body,
    }),
    ...overrides,
  };
}

const client = { id: 'client-1', tenant: 'openings', enabled: true, secret: 'test-secret' };

describe('signed intake authentication', () => {
  it('authenticates a valid request', async () => {
    const authenticateRequest = Reflect.get(authentication, 'authenticateRequest');
    expect(authenticateRequest).toBeTypeOf('function');
    await expect(authenticateRequest({
      method: 'POST', path: '/v1/publications', body, headers: await signedHeaders(),
      now: new Date(timestamp),
    }, () => Promise.resolve(client))).resolves.toMatchObject({ clientId: 'client-1', tenant: 'openings' });
  });

  it.each([
    ['unknown client', null, {}, 'Unknown'],
    ['disabled client', { ...client, enabled: false }, {}, 'disabled'],
    ['wrong tenant', client, { 'x-pub-tenant': 'troco' }, 'tenant'],
    ['body mutation', client, {}, 'hash'],
    ['bad signature', client, { 'x-pub-signature': '0'.repeat(64) }, 'signature'],
  ] as const)('rejects %s', async (_label, resolvedClient, headerOverrides, message) => {
    const authenticateRequest = Reflect.get(authentication, 'authenticateRequest');
    expect(authenticateRequest).toBeTypeOf('function');
    await expect(authenticateRequest({
      method: 'POST',
      path: '/v1/publications',
      body: _label === 'body mutation' ? `${body} ` : body,
      headers: await signedHeaders(headerOverrides),
      now: new Date(timestamp),
    }, () => Promise.resolve(resolvedClient))).rejects.toThrow(message);
  });

  it('rejects timestamps outside the five-minute window', async () => {
    const authenticateRequest = Reflect.get(authentication, 'authenticateRequest');
    expect(authenticateRequest).toBeTypeOf('function');
    await expect(authenticateRequest({
      method: 'POST', path: '/v1/publications', body, headers: await signedHeaders(),
      now: new Date('2026-09-04T15:05:01.000Z'),
    }, () => Promise.resolve(client))).rejects.toThrow('timestamp');
  });
});
