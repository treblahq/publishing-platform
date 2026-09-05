import { describe, expect, it, vi } from 'vitest';
import { createD1FailureRecorder } from './d1-failure-recorder.js';

describe('actionable delivery failures', () => {
  it('pauses only the affected tenant adapter and upserts one sanitized incident', async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const database = {
      prepare: vi.fn().mockImplementation((sql: string) => {
        const value = { sql, bindings: [] as unknown[], bind: vi.fn() };
        value.bind.mockImplementation((...bindings: unknown[]) => { value.bindings = bindings; statements.push(value); return value; });
        return value;
      }),
      batch: vi.fn().mockResolvedValue([]),
    };
    await createD1FailureRecorder(database, () => 'incident-id').record(
      'openings', 'push.onesignal', 'credential', 'ONESIGNAL_CREDENTIAL',
    );
    expect(database.batch).toHaveBeenCalledOnce();
    expect(statements.map((item) => item.sql).join('\n')).toContain('INTO adapter_controls');
    expect(statements.map((item) => item.sql).join('\n')).toContain('INTO incidents');
    expect(statements.map((item) => item.sql).join('\n')).toContain('INTO audit_events');
    expect(JSON.stringify(statements)).not.toContain('Authorization');
    expect(statements.every((item) => item.bindings.includes('openings'))).toBe(true);
  });
});
