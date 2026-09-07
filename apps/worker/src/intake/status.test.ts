import { describe, expect, it, vi } from 'vitest';
import { buildSignedHeaders } from '@trebla/publishing';
import { handlePublicationStatusRequest } from './status.js';

const now = new Date('2026-09-07T05:00:00.000Z');
const client = { id: 'social', tenant: 'openings', enabled: true, secret: 'test-only-secret' };
async function request() {
  const path = '/v1/publications/publication-1';
  return new Request(`https://worker.example${path}`, { headers: await buildSignedHeaders({
    clientId: client.id, secret: client.secret, method: 'GET', path, tenant: client.tenant,
    timestamp: now.toISOString(), nonce: 'nonce-status', body: '',
  }) });
}
describe('producer publication receipts', () => {
  it('authenticates and scopes the read to the owning tenant and producer', async () => {
    const loadStatus = vi.fn().mockResolvedValue({ publicationId: 'publication-1', deliveries: [{ state: 'verified' }] });
    const response = await handlePublicationStatusRequest(await request(), {
      now: () => now, loadClient: () => Promise.resolve(client), loadStatus,
    });
    expect(loadStatus).toHaveBeenCalledWith('openings', 'social', 'publication-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not disclose another producers publication', async () => {
    const response = await handlePublicationStatusRequest(await request(), {
      now: () => now, loadClient: () => Promise.resolve(client), loadStatus: () => Promise.resolve(null),
    });
    expect(response.status).toBe(404);
  });
  it('rejects unsigned reads before accessing publication data', async () => {
    const loadStatus = vi.fn();
    const response = await handlePublicationStatusRequest(new Request('https://worker.example/v1/publications/publication-1'), {
      now: () => now, loadClient: () => Promise.resolve(client), loadStatus,
    });
    expect(response.status).toBe(401);
    expect(loadStatus).not.toHaveBeenCalled();
  });
});
