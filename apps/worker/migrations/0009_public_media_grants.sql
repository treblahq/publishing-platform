-- Approval is finite and delivery-specific. This table does not extend artifact retention.
CREATE TABLE public_media_grants (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  approved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (tenant_id, artifact_id, delivery_id, sha256),
  CHECK (julianday(approved_at) IS NOT NULL AND julianday(expires_at) IS NOT NULL
    AND julianday(expires_at) > julianday(approved_at))
);
