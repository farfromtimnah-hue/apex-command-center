-- Client Terms question box (finance.html): collect each active/paused
-- client's payment terms so Apex can forecast income and, where the Zoho
-- recurring-invoice mechanism can take the fields cleanly, create the
-- schedule. Separate from vendor_questions -- this is about what the CLIENT
-- pays Apex, never about vendors.
--
-- One row per client. Each answer column holds the INTERPRETED value
-- (Claude's reading, confirmed by Alice); the _raw column next to it holds
-- her words verbatim, never overwritten once set. Skipping a question is
-- allowed: both columns stay NULL. completed flips to 1 only when every
-- base question (the pause questions are extra, not required) has been
-- answered or explicitly skipped -- see CLIENT_TERMS_QUESTIONS in the
-- worker, which is the single source of truth for the order and set of
-- keys; this table does not enumerate them because adding a question must
-- never require a migration.
CREATE TABLE IF NOT EXISTS client_terms (
  client_id TEXT PRIMARY KEY,
  answers_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL DEFAULT '{}',
  completed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Rate limit for Claude calls from this box, same shape as
-- vendor_question_claude_calls (5 per minute per user).
CREATE TABLE IF NOT EXISTS client_terms_claude_calls (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_client_terms_claude_calls_user ON client_terms_claude_calls (user_email, created_at);
