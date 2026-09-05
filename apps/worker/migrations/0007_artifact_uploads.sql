CREATE TABLE artifact_upload_nonces (
  producer_client_id TEXT NOT NULL REFERENCES producer_clients(id),
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (producer_client_id, nonce)
);

CREATE TABLE artifact_uploads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  producer_client_id TEXT NOT NULL REFERENCES producer_clients(id),
  locator TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 50000000),
  media_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('uploading', 'available', 'claimed', 'failed', 'deleted')),
  capacity_reservation_id TEXT NOT NULL UNIQUE REFERENCES capacity_reservations(id),
  expires_at TEXT NOT NULL,
  available_at TEXT,
  claimed_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (tenant_id, locator)
);

CREATE INDEX idx_artifact_uploads_cleanup
  ON artifact_uploads (state, expires_at, tenant_id, id);

CREATE INDEX idx_artifact_upload_nonces_expiry
  ON artifact_upload_nonces (expires_at);

-- The platform safety policy is stricter than the provider free allowance.
-- Reject strictly below 40% so accounting delay cannot cause paid usage.
UPDATE capacity_limits
SET internal_limit = 55000, warning_limit = 33000, reject_limit = 38500
WHERE resource = 'd1Rows';

UPDATE capacity_limits
SET internal_limit = 5500, warning_limit = 3300, reject_limit = 3850
WHERE resource = 'queueOperations';

UPDATE capacity_limits
SET internal_limit = 5500000000, warning_limit = 3300000000, reject_limit = 3850000000
WHERE resource = 'r2Bytes';
