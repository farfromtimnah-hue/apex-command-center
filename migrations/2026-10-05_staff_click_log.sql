-- A quiet count of what staff click (2026-10-05).
--
-- WHY: several staff tools go unused and nothing records which. One row per
-- click by alice, rafa or developer, written by POST /api/staff/click. Never a
-- client or seller. No free text: page and control are short fixed names.
--
-- Add-only: a new table and two indexes. Touches no existing table.

CREATE TABLE IF NOT EXISTS staff_click_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  role       TEXT NOT NULL,
  who        TEXT NOT NULL,
  page       TEXT NOT NULL,
  control    TEXT NOT NULL,
  client_id  TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_click_created ON staff_click_log (created_at);
CREATE INDEX IF NOT EXISTS idx_staff_click_control ON staff_click_log (control, created_at);
