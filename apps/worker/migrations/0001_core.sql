PRAGMA foreign_keys = ON;

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE producer_clients (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, name)
);

CREATE TABLE source_leases (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  publication_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, source_type, source_id, revision)
);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  producer_client_id TEXT NOT NULL REFERENCES producer_clients(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  delivery_key TEXT NOT NULL,
  adapter TEXT NOT NULL,
  operation TEXT NOT NULL,
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL,
  due_at TEXT,
  lease_token INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (publication_id, delivery_key)
);

CREATE TABLE delivery_dependencies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  depends_on_delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  required_state TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (delivery_id, depends_on_delivery_id),
  CHECK (delivery_id <> depends_on_delivery_id)
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  fencing_token INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  category TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (delivery_id, attempt_number)
);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  provider TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (delivery_id, provider, remote_id)
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  storage TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  media_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  state TEXT NOT NULL,
  tombstoned_at TEXT,
  deleted_at TEXT,
  deletion_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, sha256, storage, locator)
);

CREATE TABLE artifact_references (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  safe_to_delete INTEGER NOT NULL DEFAULT 0 CHECK (safe_to_delete IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (artifact_id, delivery_id)
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  due_at TEXT NOT NULL,
  dispatched_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE nonces (
  producer_client_id TEXT NOT NULL REFERENCES producer_clients(id),
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (producer_client_id, nonce)
);

CREATE TABLE adapter_controls (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  adapter TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, adapter)
);

CREATE TABLE capacity_usage (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  resource TEXT NOT NULL,
  window_start TEXT NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  measured_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, resource, window_start)
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  adapter TEXT,
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, fingerprint)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_publications_tenant_created ON publications (tenant_id, created_at DESC);
CREATE INDEX idx_deliveries_due ON deliveries (state, due_at);
CREATE INDEX idx_deliveries_tenant ON deliveries (tenant_id, publication_id);
CREATE INDEX idx_outbox_due ON outbox (dispatched_at, due_at);
CREATE INDEX idx_artifact_references_delivery ON artifact_references (tenant_id, delivery_id);
CREATE INDEX idx_artifacts_cleanup ON artifacts (tenant_id, state, tombstoned_at);
CREATE INDEX idx_attempts_delivery ON attempts (tenant_id, delivery_id, attempt_number);
CREATE INDEX idx_audit_tenant_created ON audit_events (tenant_id, created_at DESC);
