-- already applied to the live database on 2026-11-13; this file only records it.
-- Do NOT run these statements again and do not turn this into a migration that
-- fails when the columns exist. All columns are empty until a person sets them
-- through the screens (lost reason step, pause step, finance picker).
ALTER TABLE gm_leads ADD COLUMN lost_reason TEXT;
ALTER TABLE gm_leads ADD COLUMN lost_reason_detail TEXT;
ALTER TABLE gm_leads ADD COLUMN lost_reason_source TEXT;
ALTER TABLE gm_leads ADD COLUMN parsed_from TEXT;
ALTER TABLE gm_leads ADD COLUMN paused_until TEXT;
ALTER TABLE gm_leads ADD COLUMN paused_at TEXT;
ALTER TABLE gm_leads ADD COLUMN paused_reason TEXT;
ALTER TABLE gm_leads ADD COLUMN finance_status TEXT;
ALTER TABLE gm_leads ADD COLUMN finance_status_other TEXT;
ALTER TABLE gm_leads ADD COLUMN pause_banner_cleared_at TEXT;
ALTER TABLE gm_leads ADD COLUMN pause_banner_cleared_by TEXT;
CREATE TABLE IF NOT EXISTS gm_lead_other_log (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, lead_id TEXT, field TEXT NOT NULL, text TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'open', handled_at TEXT);
CREATE INDEX IF NOT EXISTS idx_gm_other_log_field ON gm_lead_other_log (field, status, created_at);
