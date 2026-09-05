export interface PreparedQuery {
  bind(...values: unknown[]): PreparedQuery;
  first<T>(): Promise<T | null>;
}

export interface QueryDatabase {
  prepare(sql: string): PreparedQuery;
}

export interface PublicationRow {
  id: string;
  tenant_id: string;
  producer_client_id: string;
  source_type: string;
  source_id: string;
  revision: string;
  idempotency_key: string;
  envelope_json: string;
  state: string;
  created_at: string;
  updated_at: string;
}

export interface PublicationRepository {
  findById(tenantId: string, publicationId: string): Promise<PublicationRow | null>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<PublicationRow | null>;
}

export function createPublicationRepository(database: QueryDatabase): PublicationRepository {
  return {
    findById: (tenantId, publicationId) => database.prepare(`
      SELECT * FROM publications
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(tenantId, publicationId).first<PublicationRow>(),
    findByIdempotencyKey: (tenantId, idempotencyKey) => database.prepare(`
      SELECT * FROM publications
      WHERE tenant_id = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(tenantId, idempotencyKey).first<PublicationRow>(),
  };
}
