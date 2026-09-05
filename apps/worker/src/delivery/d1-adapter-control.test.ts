import { describe, expect, it, vi } from 'vitest';
import { isD1AdapterEnabled } from './d1-adapter-control.js';

describe('tenant adapter controls', () => {
  it('allows an adapter with no explicit pause', async () => {
    const first = vi.fn().mockResolvedValue(null);
    const statement = { bind: vi.fn(), first };
    statement.bind.mockReturnValue(statement);
    await expect(isD1AdapterEnabled({ prepare: vi.fn().mockReturnValue(statement) }, 'openings', 'web.pages')).resolves.toBe(true);
    expect(statement.bind).toHaveBeenCalledWith('openings', 'web.pages');
  });

  it('blocks only the paused tenant and adapter pair', async () => {
    const statement = { bind: vi.fn(), first: vi.fn().mockResolvedValue({ enabled: 0 }) };
    statement.bind.mockReturnValue(statement);
    await expect(isD1AdapterEnabled({ prepare: vi.fn().mockReturnValue(statement) }, 'openings', 'push.onesignal')).resolves.toBe(false);
  });
});
