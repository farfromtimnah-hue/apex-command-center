-- Record of staff corrections to a client's daily log entries. Already created live by Rez.
CREATE TABLE IF NOT EXISTS client_daily_entry_edits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  section_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  old_value REAL,
  new_value REAL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_entry_edits_client ON client_daily_entry_edits (client_id, entry_date);
