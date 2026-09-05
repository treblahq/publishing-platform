import type { DeliveryState } from '@treblahq/publishing-contracts';

interface D1StateStatement {
  bind(...values: unknown[]): D1StateStatement;
}

interface D1StateDatabase {
  prepare(sql: string): D1StateStatement;
  batch(statements: D1StateStatement[]): Promise<readonly { meta?: { changes?: number } }[]>;
}

export async function commitD1DeliveryState(
  database: D1StateDatabase,
  tenantId: string,
  deliveryId: string,
  fencingToken: number,
  state: DeliveryState,
): Promise<void> {
  const statement = database.prepare(`
    UPDATE deliveries
    SET state = ?, lease_expires_at = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE tenant_id = ? AND id = ? AND lease_token = ?
  `).bind(state, tenantId, deliveryId, fencingToken);
  const [result] = await database.batch([statement]);
  if (result?.meta?.changes !== 1) {
    throw new Error('Cannot commit delivery state with stale fencing token');
  }
}
