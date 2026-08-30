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

-- Bottleneck pattern-match cache. The typed bottleneck is matched to the eight
-- patterns by one Claude call; the result is cached here keyed to the exact
-- text that produced it (matched_for), so page load never calls the model.
-- Applied to remote D1 2026-08-30.
ALTER TABLE meeting_prep_notes ADD COLUMN matched_patterns TEXT;
ALTER TABLE meeting_prep_notes ADD COLUMN matched_for TEXT;
