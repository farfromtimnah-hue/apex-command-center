-- Readable customer document links (2026-09-27, Nicole): instead of
-- apex.resonateai.online/estimate-view?t=<48 hex>, the customer receives
-- doc.resonateai.online/<business>/<doc-number>-<customer>-<random>, served by
-- this Worker with preview tags (logo, business name) so WhatsApp and iMessage
-- show a picture card, then forwarded to the real page with the real token.
-- The random suffix keeps every link unguessable; the old token links keep
-- working unchanged. One row per (kind, public_token); rows are never deleted.
CREATE TABLE IF NOT EXISTS doc_links (
  slug          TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  public_token  TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  title         TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_links_token ON doc_links (kind, public_token);
