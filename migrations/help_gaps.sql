-- Learn (Aprenda) search: the questions no guide could answer, so the missing
-- guides can be written. One row per unanswered question.
--
-- No email, no name, no token: only the language, the question (cut to 300
-- characters by the Worker), the screen key and the role. Add-only: a new table
-- and one index. Touches no existing table.
-- NOT applied yet. Apply it before turning the feature on, with:
--   npx wrangler d1 execute apex-command-center --remote --file=migrations/help_gaps.sql

CREATE TABLE IF NOT EXISTS help_gaps (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  language   TEXT NOT NULL,
  question   TEXT NOT NULL,
  page_key   TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_help_gaps_created ON help_gaps (created_at);
