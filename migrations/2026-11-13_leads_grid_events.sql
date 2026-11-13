-- Usage log for the Pipeline spreadsheet view (2026-11-13).
--
-- WHY: Pr Rafa does not say what he wants from the Pipeline. The grid records
-- what is done in it, with EVIDENCE (device, place, time, sign in) so a person
-- can judge what a client did and what Apex staff did for them. It never proves
-- who someone is.
--
-- One row per event, written by POST /api/clients/:id/gm/leads-grid-events.
-- who, role, login_ref, previewing, ip, country, region, city, asn and ua are
-- taken by the Worker from the verified session and request, never the body.
-- detail holds short fixed words and numbers only. No lead name, phone, note or
-- typed text is ever stored here.
--
-- Add-only: a new table and five indexes. Touches no existing table.

CREATE TABLE IF NOT EXISTS leads_grid_events (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  who             TEXT NOT NULL,
  role            TEXT NOT NULL,
  login_ref       TEXT,
  client_id       TEXT NOT NULL,
  mode            TEXT NOT NULL,
  action          TEXT NOT NULL,
  column_key      TEXT,
  lead_id         TEXT,
  detail          TEXT,
  row_count_after INTEGER,
  session_ref     TEXT,
  device_id       TEXT,
  previewing      INTEGER NOT NULL DEFAULT 0,
  ip              TEXT,
  country         TEXT,
  region          TEXT,
  city            TEXT,
  asn             TEXT,
  ua              TEXT
);

CREATE INDEX IF NOT EXISTS idx_lge_created        ON leads_grid_events (created_at);
CREATE INDEX IF NOT EXISTS idx_lge_client_created ON leads_grid_events (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lge_device_created ON leads_grid_events (device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lge_action_created ON leads_grid_events (action, created_at);
CREATE INDEX IF NOT EXISTS idx_lge_who_created    ON leads_grid_events (who, created_at);
