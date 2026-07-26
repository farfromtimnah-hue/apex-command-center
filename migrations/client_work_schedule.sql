-- Work schedule + blocked date ranges (2026-07-26). Three mechanisms feed
-- ONE shared "is this a working day" rule (worker/index.js isWorkingDay):
--   1. client_logins.work_schedule — JSON array of weekday numbers the
--      business operates (0=Sunday..6=Saturday), e.g. "[1,2,3,4,5,6]" for
--      Mon-Sat. NULL = never asked → the portal asks once on next login and
--      every day counts until answered (pre-feature behavior preserved).
--   2. client_blocked_ranges — planned-ahead closures (vacation, holiday
--      week). The daily log never prompts inside a range.
--   3. client_missed_days status 'day_off' (EXISTS, unchanged) — the
--      reactive one-off "discovered after the fact" case.

ALTER TABLE client_logins ADD COLUMN work_schedule TEXT;

CREATE TABLE IF NOT EXISTS client_blocked_ranges (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  start_date TEXT NOT NULL,             -- ISO YYYY-MM-DD, inclusive
  end_date   TEXT NOT NULL,             -- ISO YYYY-MM-DD, inclusive
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cbr_client ON client_blocked_ranges (client_id, start_date);
