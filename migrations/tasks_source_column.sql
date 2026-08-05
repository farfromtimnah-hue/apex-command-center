-- Distinguish where a task came from.
--
-- The "Pedidos de Ajuda / Help Request" section on tasks.html filtered on
-- type='consultant' AND due_date=today, which was never a help-request filter:
-- it worked only because help requests happened to be the sole type='consultant'
-- rows in the table. The task unification (16d09d8) added 128 session-derived
-- consultant tasks, four of them due today, and they rendered in that section.
--
-- 'help_request' — raised by a client from the portal's ask-for-help button
-- 'session'      — derived from a session's pdf_data
-- 'manual'       — created by hand via POST /api/clients/:id/tasks

ALTER TABLE tasks ADD COLUMN source TEXT;

-- One-time backfill. The description prefix is used ONLY here to recover the
-- provenance of rows written before this column existed; it must never become
-- a runtime filter. New rows are stamped at their INSERT sites instead.
UPDATE tasks SET source = 'help_request'
  WHERE description LIKE '[Pedido de ajuda / Help request]%';

UPDATE tasks SET source = 'session'
  WHERE source IS NULL AND session_id IS NOT NULL;

UPDATE tasks SET source = 'manual'
  WHERE source IS NULL;

-- The help-requests section reads source + due_date.
CREATE INDEX IF NOT EXISTS idx_tasks_source_due ON tasks (source, due_date);
