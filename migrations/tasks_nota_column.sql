-- A task the client did NOT do is not the same fact as a task nobody has
-- touched yet, and neither is a checkbox.
--
-- The weekly RDE opens on last session's tasks, and Rafa walks them one at a
-- time. A checkbox can only say done / not-done, so "nao fez" and "ainda nao
-- chegamos nisso" collapsed into the same unchecked box — and an unchecked box
-- read as an accusation for a task that was never due yet. Three states:
--
--   'pending'  pendente  — not resolved yet. The DEFAULT; never assume.
--   'done'     feito
--   'not_done' nao fez   — explicitly did not happen, and `nota` says why.
--
-- 'pending' and 'done' already exist and are untouched; this only adds the
-- third state and somewhere to put the reason. No backfill: every existing row
-- is genuinely one of the first two, and inventing 'not_done' for any of them
-- would be asserting something nobody recorded.

ALTER TABLE tasks ADD COLUMN nota TEXT;

-- The weekly prep reads last session's tasks by session_id, worst first.
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id);
