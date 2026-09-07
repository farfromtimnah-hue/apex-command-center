-- Watched Google Drive files — drift detection after a spreadsheet import.
--
-- WHY THIS EXISTS (2026-09-07):
-- JM Luxury Pools was imported from a Google Sheet on 2026-08-06. Their sellers
-- had no working logins until 08/11-08/14, so they kept working in the sheet.
-- 37 leads were created or updated there and never reached the system, including
-- a $2,000,000 estimate. Worse, edits continued to 08/27 -- three weeks after the
-- last seller got access -- and nobody knew until an audit on 09/07.
--
-- The failure was not the import. It was that NOTHING WATCHED THE SOURCE after
-- the import ran. A frozen-section check on our own tables cannot see this: the
-- client is diligently maintaining data, just in the wrong place.
--
-- This table records "we imported from this file, alert if it changes again."
-- The check runs in the existing 4-hourly cron (checkIntegrationHealth's sibling)
-- and alerts Nicole ONLY -- never the client, never Rafa. She triages first.
CREATE TABLE IF NOT EXISTS watched_files (
  id                  TEXT PRIMARY KEY,
  file_id             TEXT NOT NULL UNIQUE,     -- Google Drive file id
  label               TEXT NOT NULL,            -- human name, shown in the alert
  client_id           TEXT,                     -- optional; NULL = not client-specific
  source_url          TEXT,                     -- convenience link for investigating
  imported_at         TEXT,                     -- when we imported FROM this file
  baseline_modified   TEXT,                     -- Drive modifiedTime at the moment watching started
  last_modified_seen  TEXT,                     -- most recent modifiedTime observed
  last_modifier       TEXT,                     -- displayName of whoever last edited
  last_checked_at     TEXT,
  -- Set when a change is detected, cleared when Nicole acknowledges. Drives the
  -- dashboard banner. Deliberately NOT auto-cleared on the next check: a change
  -- must be dismissed by a human, or a quiet second edit would erase the first alert.
  alert_active        INTEGER NOT NULL DEFAULT 0,
  alert_message       TEXT,
  alert_raised_at     TEXT,
  -- Access loss is its own alarm. If Rafa unshares the file the poll 404s and the
  -- watch goes silent -- the same failure mode as the drift itself. Never fail quiet.
  access_lost         INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_watched_files_active ON watched_files(active, alert_active);
