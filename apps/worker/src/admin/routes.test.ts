import { describe, expect, it, vi } from 'vitest';

import { handleAdminRequest } from './routes.js';

const dependencies = () => ({
  token: 'admin-secret',
  ready: vi.fn().mockResolvedValue({ ready: true, capacity: { state: 'normal' } }),
  inspect: vi.fn().mockResolvedValue({ id: 'publication-1', state: 'complete' }),
  listDeliveries: vi.fn().mockResolvedValue([{ id: 'delivery-1', state: 'needs_attention' }]),
  replay: vi.fn().mockResolvedValue({ accepted: true }),
  setAdapter: vi.fn().mockResolvedValue({ changed: true }),
});

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer admin-secret');
  return new Request(`https://publishing.invalid${path}`, {
    ...init,
    headers,
  });
}

describe('authenticated administration routes', () => {
  it('rejects missing authentication without touching storage', async () => {
    const deps = dependencies();
    const response = await handleAdminRequest(new Request('https://publishing.invalid/admin/health/ready'), deps);
    expect(response.status).toBe(401);
    expect(deps.ready).not.toHaveBeenCalled();
  });

  it('reports readiness and inspects a tenant-scoped publication', async () => {
    const deps = dependencies();
    expect((await handleAdminRequest(request('/admin/health/ready'), deps)).status).toBe(200);
    expect((await handleAdminRequest(request('/admin/publications/publication-1?tenant=openings'), deps)).status).toBe(200);
    expect(deps.inspect).toHaveBeenCalledWith('openings', 'publication-1');
  });

  it('requires a reason and audits adapter pause through the operation store', async () => {
    const deps = dependencies();
    const missing = await handleAdminRequest(request('/admin/adapters/openings/push.onesignal/pause', {
      method: 'POST', body: JSON.stringify({}),
    }), deps);
    expect(missing.status).toBe(400);
    const response = await handleAdminRequest(request('/admin/adapters/openings/push.onesignal/pause', {
      method: 'POST', body: JSON.stringify({ reason: 'free tier unproven' }),
    }), deps);
    expect(response.status).toBe(200);
    expect(deps.setAdapter).toHaveBeenCalledWith('openings', 'push.onesignal', false, 'free tier unproven');
  });

  it('replays the same delivery with an explicit reason', async () => {
    const deps = dependencies();
    const response = await handleAdminRequest(request('/admin/deliveries/delivery-1/replay?tenant=openings', {
      method: 'POST', body: JSON.stringify({ reason: 'operator verified absence' }),
    }), deps);
    expect(response.status).toBe(202);
    expect(deps.replay).toHaveBeenCalledWith('openings', 'delivery-1', 'operator verified absence');
  });
});
