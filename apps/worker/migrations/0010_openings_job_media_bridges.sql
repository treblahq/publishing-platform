-- Internal immutable bindings only: no backfill, grants or retention acquisition.
CREATE TABLE openings_job_media_bridges (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) CHECK (tenant_id = 'openings'),
  job_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0 AND generation <= 9007199254740991),
  entity_revision TEXT NOT NULL,
  entity_content_sha256 TEXT NOT NULL CHECK (
    length(entity_content_sha256) = 64 AND entity_content_sha256 NOT GLOB '*[^a-f0-9]*'),
  manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
  PRIMARY KEY (tenant_id, job_id, generation)
);
