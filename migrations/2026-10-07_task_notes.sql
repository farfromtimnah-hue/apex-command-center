-- Task notes (2026-10-07): a staff task can be opened and talked about.
-- task_notes is the two-way thread on a type 'consultant' task; tasks.progress
-- is the one-click status pill (NULL, 'working', 'waiting_client').
-- Already run on the live database by Rez. Kept here for the record.
CREATE TABLE IF NOT EXISTS task_notes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, author_email TEXT, author_role TEXT NOT NULL, author_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes (task_id, created_at);
ALTER TABLE tasks ADD COLUMN progress TEXT;
