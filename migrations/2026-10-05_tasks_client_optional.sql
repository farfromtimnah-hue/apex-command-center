-- tasks.client_id becomes OPTIONAL, tasks gets created_by, and the raw voice
-- dictations get their own table (2026-10-05).
--
-- WHY
--
-- "Speak my tasks": the consultant says everything he has to do and each
-- to-do becomes a row in tasks. Many of them belong to no client ("call the
-- accountant"). There stays ONE tasks table, so client_id has to accept NULL.
--
-- WHY THIS IS A TABLE REBUILD
--
-- SQLite cannot drop NOT NULL with ALTER TABLE. The only way is: create the
-- new table, copy every row, drop the old one, rename, recreate the indexes.
--
-- WHAT CHANGES AND WHAT DOES NOT
--
--   client_id   TEXT NOT NULL  ->  TEXT            (the only changed column)
--   created_by  NEW, last column, NULL for every existing row
--   everything else: same columns, same order, same types, same NOT NULL,
--   same DEFAULTs, same five indexes with the same names and definitions.
--
-- No row's content changes. COUNT(*) and the thirteen original columns
-- (id, client_id, type, description, due_date, status, created_at,
-- session_id, due_date_source, completed_by, updated_at, source, nota) read
-- the same before and after. scripts/test-tasks-client-optional.mjs proves
-- that on a copy of this schema; check it on the live table too, before and
-- after, with:
--   SELECT COUNT(*) FROM tasks;
--   SELECT id, client_id, type, description, due_date, status, created_at,
--          session_id, due_date_source, completed_by, updated_at, source, nota
--   FROM tasks ORDER BY id;
--
-- HOW TO RUN
--
-- Once, against remote D1, BEFORE the Worker that ships with it is deployed.
-- No BEGIN / COMMIT in this file: D1 refuses them in an executed file.
-- Nothing references tasks with a foreign key and tasks has no trigger and no
-- view, so no PRAGMA is needed.
--
-- THIS FILE RUNS ONCE AND REFUSES A SECOND RUN. The first statement is a plain
-- CREATE TABLE task_voice_dumps (no IF NOT EXISTS) on purpose, and so is
-- CREATE TABLE tasks_new. A second run stops at line one and touches nothing.
-- That matters twice over: a repeat of the rebuild would copy the rows again
-- WITHOUT created_by and blank it, and if a run ever stops halfway tasks_new
-- holds the only full copy of the rows. In that case finish by hand from the
-- statement that failed.

-- The raw dictation, written BEFORE anything is done with the audio, so what a
-- person said survives a failure in any later step. status is 'received',
-- 'done' or 'failed'.
CREATE TABLE task_voice_dumps (
    id            TEXT PRIMARY KEY,
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    language      TEXT,
    transcript    TEXT,
    status        TEXT NOT NULL DEFAULT 'received',
    error         TEXT,
    tasks_created INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tasks_new (
    id              TEXT PRIMARY KEY,
    client_id       TEXT,
    type            TEXT NOT NULL,
    description     TEXT NOT NULL,
    due_date        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    session_id      TEXT,
    due_date_source TEXT,
    completed_by    TEXT,
    updated_at      TEXT,
    source          TEXT,
    nota            TEXT,
    created_by      TEXT
);

-- Every column named on both sides, so the copy cannot shift a value into the
-- wrong column. created_by is left out and so is NULL for every copied row.
INSERT INTO tasks_new (id, client_id, type, description, due_date, status, created_at,
                       session_id, due_date_source, completed_by, updated_at, source, nota)
SELECT id, client_id, type, description, due_date, status, created_at,
       session_id, due_date_source, completed_by, updated_at, source, nota
FROM tasks;

-- Dropping the table drops its five indexes with it; they are recreated below.
DROP TABLE tasks;

ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_status_due ON tasks (status, due_date);
CREATE INDEX idx_tasks_client ON tasks (client_id, status);
CREATE UNIQUE INDEX idx_tasks_session_dedupe ON tasks (session_id, type, description) WHERE session_id IS NOT NULL;
CREATE INDEX idx_tasks_source_due ON tasks (source, due_date);
CREATE INDEX idx_tasks_session ON tasks (session_id);
