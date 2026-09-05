CREATE TABLE web_entity_manifests (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL CHECK (kind IN ('job', 'author', 'community')),
  entity_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  title TEXT NOT NULL,
  summary TEXT,
  canonical_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, kind, entity_id),
  UNIQUE (tenant_id, kind, entity_id, revision, content_sha256)
);

CREATE INDEX idx_web_entity_manifests_route
  ON web_entity_manifests (tenant_id, canonical_path);
