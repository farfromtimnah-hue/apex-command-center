-- Client portal estimates & invoices — PHASE 2: estimates.
-- Money is integer cents. Nothing here is ever deleted: a corrected
-- estimate is voided (reason kept) or superseded by a new revision.

-- Per-client document numbers. Allocated with a compare-and-set UPDATE
-- (gmDocAllocateNumber), never re-used, formatted EST-0001 / INV-0001 /
-- RCT-0001 / CR-0001 / REF-0001.
CREATE TABLE IF NOT EXISTS gm_doc_counters (
  client_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- EST | INV | RCT | CR | REF
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (client_id, kind)
);

CREATE TABLE IF NOT EXISTS gm_estimates (
  id                       TEXT PRIMARY KEY,
  client_id                TEXT NOT NULL,
  lead_id                  TEXT NOT NULL,
  job_id                   TEXT,
  number                   TEXT NOT NULL,       -- EST-0001, shared by every revision
  revision                 INTEGER NOT NULL DEFAULT 1,
  status                   TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | viewed | changes_requested | accepted | declined | expired | superseded | void
  mode                     TEXT NOT NULL DEFAULT 'single', -- single | tiered
  job_name                 TEXT NOT NULL,
  customer_name            TEXT,
  customer_email           TEXT,
  customer_phone           TEXT,
  customer_address         TEXT,
  valid_until              TEXT,               -- YYYY-MM-DD
  discount_type            TEXT,               -- amount | pct
  discount_value           REAL,               -- cents when amount, percent when pct
  schedule_json            TEXT NOT NULL DEFAULT '[]',  -- [{label, pct, amount_cents}]
  terms_included           TEXT,
  terms_excluded           TEXT,
  customer_notes           TEXT,               -- printed
  internal_notes           TEXT,               -- never printed
  public_token             TEXT NOT NULL,
  sent_at                  TEXT,
  first_viewed_at          TEXT,
  last_viewed_at           TEXT,
  responded_at             TEXT,
  change_request_text      TEXT,
  decline_reason           TEXT,
  accepted_option_id       TEXT,
  accepted_signer_name     TEXT,
  accepted_signature_kind  TEXT,               -- typed | drawn
  accepted_signature_r2_key TEXT,
  accepted_ip              TEXT,
  accepted_user_agent      TEXT,
  accepted_at              TEXT,
  accepted_by_kind         TEXT,               -- customer | contractor
  accepted_by_actor        TEXT,
  content_hash             TEXT,               -- SHA-256 of the exact snapshot accepted
  snapshot_r2_key          TEXT,
  pdf_r2_key               TEXT,
  created_by               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason              TEXT,
  voided_by                TEXT,
  voided_at                TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_estimates_token ON gm_estimates (public_token);
CREATE INDEX IF NOT EXISTS idx_gm_estimates_client ON gm_estimates (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gm_estimates_lead ON gm_estimates (lead_id, created_at);

-- Best / Better / Good (tiered) or the single option. Totals are computed
-- by the Worker from the items and stored for listing; the items are the
-- source of truth.
CREATE TABLE IF NOT EXISTS gm_estimate_options (
  id              TEXT PRIMARY KEY,
  estimate_id     TEXT NOT NULL,
  tier            TEXT NOT NULL,               -- best | better | good | single
  label           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gm_estimate_options_est ON gm_estimate_options (estimate_id, sort_order);

CREATE TABLE IF NOT EXISTS gm_estimate_items (
  id                    TEXT PRIMARY KEY,
  estimate_id           TEXT NOT NULL,
  option_id             TEXT NOT NULL,
  category              TEXT,
  pricing_id            TEXT,                  -- gm_pricing row it came from, if any
  item_name             TEXT NOT NULL,
  description           TEXT,
  line_type             TEXT NOT NULL DEFAULT 'standard',  -- standard | included | allowance
  qty                   REAL NOT NULL DEFAULT 1,
  unit                  TEXT,
  rate_cents            INTEGER NOT NULL DEFAULT 0,
  amount_cents          INTEGER NOT NULL DEFAULT 0,
  preset_rate_cents     INTEGER,               -- the price-list rate at the time, when overridden
  rate_override_reason  TEXT,
  material_cost_cents   INTEGER,
  labor_cost_cents      INTEGER,
  other_cost_cents      INTEGER,
  is_addon              INTEGER NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gm_estimate_items_est ON gm_estimate_items (estimate_id, option_id, sort_order);

-- On the lead: when the first estimate went out (NOT data_estimate, which is
-- the in-home visit), and the pending commission review.
ALTER TABLE gm_leads ADD COLUMN estimate_sent_at TEXT;
ALTER TABLE gm_leads ADD COLUMN commission_review_json TEXT;   -- {from_cents, to_cents, at} or NULL
