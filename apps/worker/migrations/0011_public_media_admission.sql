-- Provisioning is trusted and external to the public request path. No initial allocation.
CREATE TABLE public_media_admission_allocations (
  account_id TEXT PRIMARY KEY NOT NULL
    CHECK (typeof(account_id) = 'text' AND length(account_id) = 32
      AND length(CAST(account_id AS BLOB)) = 32 AND account_id NOT GLOB '*[^a-f0-9]*'),
  enabled INTEGER NOT NULL CHECK (typeof(enabled) = 'integer' AND enabled IN (0, 1)),
  measured_at_ms INTEGER NOT NULL
    CHECK (typeof(measured_at_ms) = 'integer' AND measured_at_ms BETWEEN 0 AND 9007199254740991),
  expires_at_ms INTEGER NOT NULL
    CHECK (typeof(expires_at_ms) = 'integer' AND expires_at_ms BETWEEN 0 AND 9007199254740991
      AND expires_at_ms > measured_at_ms AND expires_at_ms - measured_at_ms <= 900000),
  d1_reads_limit INTEGER NOT NULL
    CHECK (typeof(d1_reads_limit) = 'integer' AND d1_reads_limit BETWEEN 0 AND 9007199254740991),
  d1_reads_reserved INTEGER NOT NULL
    CHECK (typeof(d1_reads_reserved) = 'integer' AND d1_reads_reserved BETWEEN 0 AND d1_reads_limit),
  d1_writes_limit INTEGER NOT NULL
    CHECK (typeof(d1_writes_limit) = 'integer' AND d1_writes_limit BETWEEN 0 AND 9007199254740991),
  d1_writes_reserved INTEGER NOT NULL
    CHECK (typeof(d1_writes_reserved) = 'integer' AND d1_writes_reserved BETWEEN 0 AND d1_writes_limit),
  r2_class_b_limit INTEGER NOT NULL
    CHECK (typeof(r2_class_b_limit) = 'integer' AND r2_class_b_limit BETWEEN 0 AND 9007199254740991),
  r2_class_b_reserved INTEGER NOT NULL
    CHECK (typeof(r2_class_b_reserved) = 'integer' AND r2_class_b_reserved BETWEEN 0 AND r2_class_b_limit)
);
