-- Curated stories Rafa can tell in a meeting. Multi-tagged: one story serves
-- several patterns, because the same arc answers different questions depending
-- on which part you lead with.
CREATE TABLE IF NOT EXISTS stories (
  id           TEXT PRIMARY KEY,
  client_id    TEXT,
  person       TEXT NOT NULL,
  business     TEXT,
  country      TEXT,
  industry     TEXT,
  source       TEXT NOT NULL,
  source_url   TEXT,
  patterns     TEXT NOT NULL,
  one_liner    TEXT NOT NULL,
  signals      TEXT,
  narrative    TEXT,
  telling_note TEXT NOT NULL,
  approved     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_stories_approved ON stories (approved);
