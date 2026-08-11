-- Hide a client from every list without deleting it.
--
-- THE LEAK. handleGetClients was "SELECT ... FROM clients ORDER BY name ASC"
-- with NO status filter at all, so every screen and dropdown fed by it got
-- every row — including TEST CLIENT RH - DO NOT USE and TESTING CLIENT PORTAL
-- - DO NOT CLOSE. Other list queries in the same file DO filter
-- (WHERE status = 'active' OR status IS NULL), which is exactly why these
-- appeared in some places and not others.
--
-- This already cost real time: a duplicate "JM Luxury Pools" row survived a
-- merge, kept showing up in dropdowns, and opening it rendered a completely
-- empty portal — a whole session then chased a "lead display bug" that was
-- really the wrong client being open.
--
-- ⚠️ WHY A DEDICATED COLUMN AND NOT ANOTHER status VALUE. A previous attempt
-- set an unrecognised status to hide a row and it did nothing, because
-- nothing reads status on that path. status is already overloaded — active,
-- lead, lead_dormant, closed, consolidated — and an unknown value fails
-- SILENTLY: no error, no effect, and the row keeps appearing. A boolean the
-- worker explicitly excludes cannot fail that way.
--
-- ARCHIVING HIDES FROM LISTS; IT DOES NOT BREAK A RECORD. A direct fetch by
-- id still works, so an existing link, a bookmark or an open portal session
-- keeps functioning. Archiving is reversible; there is deliberately NO delete.

ALTER TABLE clients ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN archived_at TEXT;
ALTER TABLE clients ADD COLUMN archived_by TEXT;

-- Partial index: the lists all filter on archived = 0, and the archived set
-- is tiny, so indexing only the visible rows keeps it small.
CREATE INDEX IF NOT EXISTS idx_clients_archived ON clients (archived);

-- The two test clients. Archived, NOT deleted — the second is named
-- "DO NOT CLOSE" for a reason, and archiving is reversible.
-- Matched by exact name so this cannot catch a real client.
UPDATE clients
SET archived = 1,
    archived_at = datetime('now'),
    archived_by = 'migration:clients_archived'
WHERE archived = 0
  AND name IN ('TEST CLIENT RH - DO NOT USE', 'TESTING CLIENT PORTAL - DO NOT CLOSE');
