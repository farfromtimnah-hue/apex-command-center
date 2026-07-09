-- Stores Fireflies transcript IDs Rafa/Alice dismissed from the "Pull from
-- Fireflies" picker in Sessions inbox. Dismissing only hides a transcript
-- from GET /api/fireflies/transcripts going forward -- it never touches
-- Fireflies' own data, and never deletes anything already imported into D1.
CREATE TABLE IF NOT EXISTS fireflies_dismissed_transcripts (
  transcript_id TEXT PRIMARY KEY,
  dismissed_by  TEXT,
  dismissed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
