import { describe, expect, it } from 'vitest';

import { parseCommand } from './command.js';

describe('publ CLI commands', () => {
  it.each([
    [['status'], { method: 'GET', path: '/admin/health/ready' }],
    [['capacity'], { method: 'GET', path: '/admin/health/ready' }],
    [['inspect', 'publication-1', '--tenant', 'openings'], { method: 'GET', path: '/admin/publications/publication-1?tenant=openings' }],
    [['deliveries', '--tenant', 'openings', '--state', 'needs_attention'], { method: 'GET', path: '/admin/deliveries?tenant=openings&state=needs_attention' }],
    [['replay', 'delivery-1', '--tenant', 'openings', '--reason', 'verified absence'], { method: 'POST', path: '/admin/deliveries/delivery-1/replay?tenant=openings', body: { reason: 'verified absence' } }],
    [['pause', 'openings/push.onesignal', '--reason', 'MAU stale'], { method: 'POST', path: '/admin/adapters/openings/push.onesignal/pause', body: { reason: 'MAU stale' } }],
    [['resume', 'openings/push.onesignal', '--reason', 'MAU verified'], { method: 'POST', path: '/admin/adapters/openings/push.onesignal/resume', body: { reason: 'MAU verified' } }],
  ] as const)('maps %j to the authenticated admin API', (input, expected) => {
    expect(parseCommand([...input])).toEqual(expected);
  });

  it('rejects mutable operations without an audit reason', () => {
    expect(() => parseCommand(['replay', 'delivery-1', '--tenant', 'openings'])).toThrow('reason');
  });
});
