-- "Tell us" support box (dashboard.html, staff only): Alice (or any staff
-- user) reports something broken or needed; Claude asks up to 3 follow-up
-- questions so the ticket arrives complete, then a developer resolves it
-- from the dashboard's Support panel. Claude never writes anything else and
-- never fixes anything -- this table is the only write path.
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  reporter_email TEXT,
  reporter_name TEXT,
  language TEXT,
  kind TEXT,
  page TEXT,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  original_words TEXT NOT NULL,
  summary_en TEXT,
  guidance TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, created_at);

-- Per-user, per-day cap (10 reports/day) to protect API credit.
CREATE TABLE IF NOT EXISTS support_ticket_daily_counts (
  user_email TEXT,
  day TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_email, day)
);
