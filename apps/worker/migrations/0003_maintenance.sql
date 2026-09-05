CREATE TABLE maintenance_cursors (
  name TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
