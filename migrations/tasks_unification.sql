-- Task unification: one `tasks` table becomes the single source of truth for
-- Rafa's Tasks page, the client profile, and the Overview tile. Until now the
-- Tasks page derived its rows on the fly from sessions.pdf_data and stored
-- completions in sessions.task_completions, so a checkbox ticked in one view
-- was invisible in the others.
--
-- Adds the columns the migrated rows need. Additive only — no drops, no
-- deletes. Existing rows keep their values and get NULLs in the new columns,
-- which the backfill step then fills.

-- Provenance: which session a migrated task was derived from. NULL for rows
-- that were created directly in the tasks table.
ALTER TABLE tasks ADD COLUMN session_id TEXT;

-- How due_date was arrived at: 'stated' (written on the task itself),
-- 'session+7', or 'created+7'. Keeps a derived date distinguishable from one
-- a human actually set.
ALTER TABLE tasks ADD COLUMN due_date_source TEXT;

-- Who/what completed the task: 'migrated-from-session', 'system-sweep', or a
-- user identifier. NULL while pending.
ALTER TABLE tasks ADD COLUMN completed_by TEXT;

-- Last write time. No DEFAULT expression: SQLite forbids non-constant
-- defaults on ALTER TABLE ADD COLUMN, so writers set this explicitly.
ALTER TABLE tasks ADD COLUMN updated_at TEXT;

-- Overview tile and Tasks page both filter by status + due_date.
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks (status, due_date);

-- Client profile lists a single client's tasks.
CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks (client_id, status);

-- Guards against double-importing a derived task on a re-run: one row per
-- (session, type, description).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_session_dedupe
  ON tasks (session_id, type, description)
  WHERE session_id IS NOT NULL;
