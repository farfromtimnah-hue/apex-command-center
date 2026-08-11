-- Dated note threads on a LEAD or a PROJECT, inside the client portal.
--
-- A thread, not a text field: one row per note, newest first, each showing
-- who wrote it and when. "We spoke Tuesday, he wants the spa moved" is a
-- dated event by a person, and a single overwritable box loses both the
-- history and the author the moment somebody else types in it.
--
-- gm_leads.observacao IS NOT MIGRATED INTO THIS TABLE AND IS NOT REMOVED.
-- That column is a FIELD ON THE LEAD RECORD -- "observação do trabalho", what
-- this job is -- and it stays exactly where it is, edited on the lead like
-- every other field. This table is the running history beside it. Folding one
-- into the other would destroy the distinction and rewrite existing records.
--
-- ONE TABLE FOR BOTH PARENTS. parent_type + parent_id rather than two
-- near-identical tables, because every read, write and permission rule is
-- the same shape for a lead and a job. The CHECK keeps the column honest --
-- a typo'd parent_type writes nothing rather than creating an invisible
-- third category no reader will ever query.
--
-- created_by / created_at are SERVER-SET, following the client_notes and
-- lead_contact_log convention exactly: derived from the authenticated user,
-- never trusted from the request body, and never user-editable afterwards.
-- The author of a note is evidence; a client-supplied author is decoration.
--
-- Sellers cannot reach these routes: sellerRequestAllowed() is a strict
-- allowlist and none of them are listed in it.

CREATE TABLE IF NOT EXISTS gm_notes (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('lead','job')),
  parent_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_by  TEXT,            -- server-set from the authenticated user, NEVER trusted from the client
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The thread read: every note on one record, in time order.
CREATE INDEX IF NOT EXISTS idx_gm_notes_parent
  ON gm_notes (parent_type, parent_id, created_at);

-- Every client-scoped read filters on this.
CREATE INDEX IF NOT EXISTS idx_gm_notes_client
  ON gm_notes (client_id);
