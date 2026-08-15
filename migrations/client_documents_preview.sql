-- Placeholder deliverables: a document that EXISTS but whose file is still
-- sitting in Pr. Rafa's Claude history.
--
-- The problem this solves is forgetting, not storage. He already has a Google
-- Drive folder per client; things get lost because in the moment he does not
-- file them. So his Claude records the deliverable on the client's profile
-- immediately, and the file catches up.
--
-- Why a preview at all: a placeholder carrying only a title is not enough to
-- recognise WHICH catalog it is when three exist. The HTML already exists —
-- he iterates in HTML and only converts to PDF once he approves — so storing
-- it costs nothing and turns the placeholder into something he can open and
-- identify before going to fetch the real file.
--
-- A row is a placeholder when file_url IS NULL. Nothing else marks it.
--
-- ⚠️ file_url and file_name were both NOT NULL, so a placeholder could not be
-- inserted at all — caught by the database rejecting the first test row, not
-- by reading the schema. SQLite cannot drop a NOT NULL in place, so the table
-- was rebuilt with file_url nullable: 53 rows out, 53 rows in, verified equal
-- before the old table was dropped, and both indexes recreated afterwards
-- (they go with the dropped table).
--
-- file_name stays NOT NULL and carries the name the file WILL have, which is
-- also what he needs in order to find it in his Claude history.

-- The approved HTML, kept as the quick-look version. Also what Pra. Alice and
-- (if he shares it) the client can read while the PDF is still missing.
ALTER TABLE client_documents ADD COLUMN preview_html TEXT;

-- Pra. Alice can ask him to upload the real file. Deliberately NOT available
-- to the client: a client having to ask for the deliverable they were already
-- promised is a bad look, and the warning shown when he makes a preview-only
-- document visible is what prevents that situation instead.
--
-- Cleared automatically when the file lands, so nobody has to close it.
ALTER TABLE client_documents ADD COLUMN file_requested_at TEXT;
ALTER TABLE client_documents ADD COLUMN file_requested_by TEXT;

-- The rebuild, as executed:
--
-- CREATE TABLE client_documents_new (
--   id TEXT PRIMARY KEY, client_id TEXT NOT NULL, title TEXT NOT NULL,
--   file_name TEXT NOT NULL, file_url TEXT,            -- nullable now
--   content_type TEXT, uploaded_by TEXT,
--   created_at TEXT NOT NULL DEFAULT (datetime('now')),
--   visibility TEXT NOT NULL DEFAULT 'client',
--   client_visible INTEGER NOT NULL DEFAULT 1,
--   preview_html TEXT, file_requested_at TEXT, file_requested_by TEXT);
-- INSERT INTO client_documents_new SELECT ... FROM client_documents;
-- DROP TABLE client_documents;
-- ALTER TABLE client_documents_new RENAME TO client_documents;
-- CREATE INDEX idx_client_documents_visibility     ON client_documents (client_id, visibility);
-- CREATE INDEX idx_client_documents_client_visible ON client_documents (client_id, client_visible);
