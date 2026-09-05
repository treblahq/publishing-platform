interface Statement {
  bind(...values: unknown[]): Statement;
}

interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
}

export function createD1FailureRecorder(
  database: Database,
  createId: () => string = () => crypto.randomUUID(),
) {
  return {
    record: async (tenant: string, adapter: string, category: string, code: string): Promise<void> => {
      const fingerprint = `${tenant}:${adapter}:${category}`;
      const summary = `${adapter} paused after ${category} failure (${code})`;
      await database.batch([
        database.prepare(`INSERT INTO adapter_controls (tenant_id, adapter, enabled, reason)
          VALUES (?, ?, 0, ?) ON CONFLICT(tenant_id, adapter) DO UPDATE SET enabled = 0,
          reason = excluded.reason, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
          .bind(tenant, adapter, summary),
        database.prepare(`INSERT INTO incidents
          (id, tenant_id, adapter, fingerprint, category, summary, state)
          VALUES (?, ?, ?, ?, ?, ?, 'open')
          ON CONFLICT(tenant_id, fingerprint) DO UPDATE SET summary = excluded.summary,
          state = 'open', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
          .bind(createId(), tenant, adapter, fingerprint, category, summary),
        database.prepare(`INSERT INTO audit_events
          (id, tenant_id, actor, action, target_type, target_id, details_json)
          VALUES (?, ?, 'worker', 'adapter.auto_paused', 'adapter', ?, ?)`)
          .bind(createId(), tenant, adapter, JSON.stringify({ category, code })),
      ]);
    },
  };
}
