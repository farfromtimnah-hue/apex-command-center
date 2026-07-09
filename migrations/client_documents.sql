-- Manual document uploads for the client profile "Documents" section
-- (old proposals, meeting summaries, etc. that predate the live session/report
-- pipeline). Coexists with the auto-generated session reports already shown
-- there; distinguished in the UI as "Uploaded" vs "Generated".

CREATE TABLE IF NOT EXISTS client_documents (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_url     TEXT NOT NULL,          -- R2 key, served via Worker (no raw R2 paths exposed)
  content_type TEXT,
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_documents_client_id ON client_documents (client_id);
