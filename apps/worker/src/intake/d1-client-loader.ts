import { sha256Hex } from '@trebla/publishing';

import type { ProducerClientCredential, ProducerClientLoader } from './authenticate.js';

interface ClientStatement {
  bind(...values: unknown[]): ClientStatement;
  first(): Promise<unknown>;
}

interface ClientDatabase {
  prepare(sql: string): ClientStatement;
}

interface ClientRow {
  id: string;
  tenant_id: string;
  client_enabled: number;
  tenant_enabled: number;
  secret_hash: string;
}

export function createD1ProducerClientLoader(
  database: ClientDatabase,
  resolveSecret: (clientId: string) => string | undefined,
): ProducerClientLoader {
  return async (clientId): Promise<ProducerClientCredential | null> => {
    const value = await database.prepare(`
      SELECT clients.id, clients.tenant_id, clients.enabled AS client_enabled,
             tenants.enabled AS tenant_enabled, clients.secret_hash
      FROM producer_clients AS clients
      JOIN tenants ON tenants.id = clients.tenant_id
      WHERE clients.id = ?
      LIMIT 1
    `).bind(clientId).first();
    if (!isClientRow(value)) return null;
    const row = value;
    const secret = resolveSecret(clientId);
    if (secret === undefined || !constantTimeEqual(await sha256Hex(secret), row.secret_hash)) return null;
    return {
      id: row.id,
      tenant: row.tenant_id,
      enabled: row.client_enabled === 1 && row.tenant_enabled === 1,
      secret,
    };
  };
}

function isClientRow(value: unknown): value is ClientRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string'
    && typeof row.tenant_id === 'string'
    && typeof row.client_enabled === 'number'
    && typeof row.tenant_enabled === 'number'
    && typeof row.secret_hash === 'string';
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
