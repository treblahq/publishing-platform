CREATE TABLE capacity_limits (
  resource TEXT PRIMARY KEY,
  free_allowance INTEGER NOT NULL CHECK (free_allowance > 0),
  internal_limit INTEGER NOT NULL CHECK (internal_limit > 0),
  warning_limit INTEGER NOT NULL CHECK (warning_limit >= 0),
  reject_limit INTEGER NOT NULL CHECK (reject_limit > 0),
  CHECK (internal_limit * 100 <= free_allowance * 70),
  CHECK (warning_limit <= reject_limit),
  CHECK (reject_limit <= internal_limit)
);

CREATE TABLE capacity_reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  publication_id TEXT REFERENCES publications(id),
  resource TEXT NOT NULL REFERENCES capacity_limits(resource),
  amount INTEGER NOT NULL CHECK (amount > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usage_attestations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  observed_value INTEGER NOT NULL CHECK (observed_value >= 0),
  provider_ceiling INTEGER NOT NULL CHECK (provider_ceiling > 0),
  internal_pause INTEGER NOT NULL CHECK (internal_pause > 0),
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider),
  CHECK (internal_pause < provider_ceiling)
);

CREATE TABLE hourly_metrics (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  adapter TEXT NOT NULL,
  hour TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed >= 0),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable >= 0),
  failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  PRIMARY KEY (tenant_id, adapter, hour)
);

CREATE INDEX idx_capacity_reservations_active
  ON capacity_reservations (tenant_id, resource, state, expires_at);
CREATE INDEX idx_attestations_expiry
  ON usage_attestations (tenant_id, provider, expires_at);
CREATE INDEX idx_metrics_tenant_hour
  ON hourly_metrics (tenant_id, hour DESC);
