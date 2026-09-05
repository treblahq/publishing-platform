export interface DeliveryAttemptStore {
  start(tenant: string, deliveryId: string, fencingToken: number): Promise<string>;
  finish(tenant: string, attemptId: string, category?: string, code?: string): Promise<void>;
}

interface Statement { bind(...values: unknown[]): Statement; run(): Promise<unknown> }
interface Database { prepare(sql: string): Statement }

export function createD1AttemptStore(
  database: Database,
  createId: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
): DeliveryAttemptStore {
  return {
    start: async (tenant, deliveryId, token) => {
      const id = createId();
      await database.prepare(`INSERT INTO attempts
        (id, tenant_id, delivery_id, fencing_token, attempt_number, started_at)
        SELECT ?, ?, ?, ?, COALESCE(MAX(attempt_number), 0) + 1, ? FROM attempts
        WHERE delivery_id = ?`).bind(id, tenant, deliveryId, token, now().toISOString(), deliveryId).run();
      return id;
    },
    finish: async (tenant, id, category, code) => {
      await database.prepare(`UPDATE attempts SET category = ?, error_code = ?, finished_at = ?
        WHERE tenant_id = ? AND id = ?`).bind(category ?? null, code ?? null, now().toISOString(), tenant, id).run();
    },
  };
}
