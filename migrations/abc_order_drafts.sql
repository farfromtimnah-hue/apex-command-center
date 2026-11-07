-- ABC order drafts, saved delivery locations (2026-11-07).
--
-- A signed contract whose accepted estimate has ABC linked lines gets ONE live
-- draft order. The owner reviews it and sends it (one at a time or in batch).
-- Text columns under a UNIQUE index are NOT NULL with a default (a NULL would
-- defeat the UNIQUE in SQLite).
--
-- ADD-ONLY and safe to run once. CREATE ... IF NOT EXISTS makes a second run
-- harmless; the ALTER fails with "duplicate column name" the second time.
--
-- ORDER: deploy the Worker FIRST or AFTER, either is safe. Without these
-- tables the draft routes answer "not available yet" and signing is unaffected.

CREATE TABLE IF NOT EXISTS gm_abc_delivery_locations (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  line1         TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL DEFAULT '',
  postal        TEXT NOT NULL DEFAULT '',
  last_used_at  TEXT NOT NULL DEFAULT '',
  archived      INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, name)
);

CREATE TABLE IF NOT EXISTS gm_abc_order_drafts (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  contract_id      TEXT NOT NULL,
  estimate_id      TEXT NOT NULL DEFAULT '',
  project_id       TEXT NOT NULL DEFAULT '',
  job_name         TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | combined | discarded
  delivery_service TEXT NOT NULL DEFAULT '',        -- COM CPU EXP OTR OTG OTW TPC, or '' until the owner picks
  delivery_date    TEXT NOT NULL DEFAULT '',        -- YYYY-MM-DD or '' (the branch decides)
  delivery_to      TEXT NOT NULL DEFAULT '',        -- job | saved | '' until the owner picks
  location_id      TEXT NOT NULL DEFAULT '',
  ship_name        TEXT NOT NULL DEFAULT '',        -- copied at send time
  ship_line1       TEXT NOT NULL DEFAULT '',
  ship_city        TEXT NOT NULL DEFAULT '',
  ship_state       TEXT NOT NULL DEFAULT '',
  ship_postal      TEXT NOT NULL DEFAULT '',
  contact_name     TEXT NOT NULL DEFAULT '',
  contact_email    TEXT NOT NULL DEFAULT '',
  contact_phone    TEXT NOT NULL DEFAULT '',
  order_ref        TEXT NOT NULL DEFAULT '',
  abc_confirmation TEXT NOT NULL DEFAULT '',
  combined_into    TEXT NOT NULL DEFAULT '',        -- the draft id (or order ref) a combined order went out as
  created_by       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One live draft per contract.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_abc_drafts_live
  ON gm_abc_order_drafts (client_id, contract_id) WHERE status = 'draft';
-- A purchase order number belongs to one live or sent draft of a business.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_abc_drafts_ref
  ON gm_abc_order_drafts (client_id, order_ref) WHERE order_ref <> '' AND status IN ('draft', 'sent');
CREATE INDEX IF NOT EXISTS idx_gm_abc_drafts_client ON gm_abc_order_drafts (client_id, status, created_at);

CREATE TABLE IF NOT EXISTS gm_abc_order_draft_lines (
  id                TEXT PRIMARY KEY,
  draft_id          TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  item_number       TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  quantity          REAL,                           -- NULL = the owner must set the quantity
  uom               TEXT NOT NULL DEFAULT '',
  extra_percent_used REAL,
  extra_source      TEXT NOT NULL DEFAULT '',       -- standard | item | '' (none)
  unit_price        REAL,                           -- the price the owner reviewed
  source_line_id    TEXT NOT NULL DEFAULT '',
  removed           INTEGER NOT NULL DEFAULT 0,
  added_by_hand     INTEGER NOT NULL DEFAULT 0,
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gm_abc_draft_lines ON gm_abc_order_draft_lines (draft_id, sort_order);
