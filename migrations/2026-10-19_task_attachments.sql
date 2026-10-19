-- Task 1.4: photos and documents attached to a task. Additive only. Files
-- live in R2 (binding TASK_FILES, bucket apex-task-files); this table is
-- only the index. removed_at marks a soft removal -- no hard delete, no R2
-- delete, per the brief's "no automatic deletions".
CREATE TABLE IF NOT EXISTS task_attachments (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  file_key      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type  TEXT,
  size_bytes    INTEGER,
  uploaded_by   TEXT,
  created_at    TEXT NOT NULL,
  removed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments (task_id);
