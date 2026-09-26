-- Client portal estimates & invoices — PHASE 1: foundation.
--
-- The client's OWN documents to THEIR customers (a pool builder quoting a
-- homeowner). Entirely separate from the existing invoices /
-- invoice_line_items / invoice_payments / invoice_counter tables, which are
-- Apex billing its own clients and are coupled to Plaid, Stripe and Zoho.
-- Those tables are not touched by this build.
--
-- Money in every NEW table of this build is stored as integer cents. The
-- pre-existing gm_pricing keeps its REAL dollars (its UI and CSV import are
-- built around them); the estimate builder converts at the boundary.
--
-- Nothing here is ever deleted by the app: corrections are soft (void,
-- reverse, supersede) with a stored reason.

-- One row per client: business identity, payment terms, accepted payment
-- methods, schedule presets and the three send-message templates. The
-- setup_completed_at stamp is what the portal reads to decide whether the
-- Estimates tab opens on the list or on Settings the first time.
CREATE TABLE IF NOT EXISTS gm_doc_settings (
  client_id             TEXT PRIMARY KEY,
  hero_r2_key           TEXT,                              -- doc-heroes/<clientId>.<ext>
  legal_name            TEXT,
  address               TEXT,
  phone                 TEXT,
  email                 TEXT,
  license_numbers       TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings; at least one required to complete setup (§489.119)
  min_margin_pct        REAL,                              -- optional; nothing depends on it being set
  estimate_valid_days   INTEGER NOT NULL DEFAULT 30,
  default_terms_days    INTEGER NOT NULL DEFAULT 0,        -- 0 = due on receipt
  payment_methods_json  TEXT NOT NULL DEFAULT '{}',        -- {zelle:"detail", check:"payable to", cash:"", money_order:"", bank_transfer:"instructions", card_link:"https://...", other:"text"} — only TICKED methods are present
  late_fee_annual_pct   REAL,                              -- NULL = no penalty; never above 18 (§687.03)
  late_fee_grace_days   INTEGER,
  schedule_presets_json TEXT NOT NULL DEFAULT '[]',        -- JSON [{name, steps:[{label, pct}]}]; steps total exactly 100, or [] for "Custom"
  estimate_message      TEXT,                              -- send-message templates; placeholders {customer_first_name} {job_name} {business_name} {seller_name} {link}
  invoice_message       TEXT,
  receipt_message       TEXT,
  setup_completed_at    TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by            TEXT
);

-- Every change to a setting or a message template, one row per changed
-- field. actor is SERVER-SET from the session, never from the body.
CREATE TABLE IF NOT EXISTS gm_doc_settings_history (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_doc_settings_history_client
  ON gm_doc_settings_history (client_id, created_at);

-- Price list additions. category groups items on the estimate; kind splits
-- products from add-ons (an add-on is offered only when a product of the same
-- category was chosen); description is the customer-facing spec text printed
-- under the line. cost_breakdown lines gain a "type" property
-- ("material" | "labor" | "other", default "material" when absent) — a JSON
-- shape change, not a column; old rows without it read as material.
ALTER TABLE gm_pricing ADD COLUMN category TEXT;
ALTER TABLE gm_pricing ADD COLUMN kind TEXT NOT NULL DEFAULT 'product';
ALTER TABLE gm_pricing ADD COLUMN description TEXT;

-- Why a value changed, when the app asked for a reason (a rate override on an
-- estimate line, a prefilled cost edited on the lead). Nullable: ordinary
-- events carry none.
ALTER TABLE gm_lead_events ADD COLUMN reason TEXT;
