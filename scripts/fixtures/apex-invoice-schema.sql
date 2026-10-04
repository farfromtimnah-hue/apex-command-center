-- Read-only snapshot of the production table definitions the Apex invoice
-- and Apex Club money paths use, taken 2026-10-04 BEFORE the public invoice
-- build. scripts/test-apex-invoice-regression.mjs loads it into an in-memory
-- SQLite so the real Worker functions run against the real schema.

CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  plaid_item_id    TEXT,
  plaid_account_id TEXT UNIQUE,
  institution      TEXT,
  name             TEXT,
  mask             TEXT,
  subtype          TEXT,
  purpose          TEXT NOT NULL CHECK (purpose IN ('business','personal')),
  balance_cents    INTEGER,
  available_cents  INTEGER,
  last_synced_at   TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE apex_club_event_dismissed (
  event_id       TEXT NOT NULL REFERENCES apex_club_events(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  dismissed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_by   TEXT,
  PRIMARY KEY (event_id, transaction_id)
);

CREATE TABLE apex_club_event_txns (
  event_id       TEXT NOT NULL REFERENCES apex_club_events(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  -- 'income' = an attendee paying, 'expense' = food, books, venue.
  side           TEXT NOT NULL CHECK (side IN ('income','expense')),
  -- How many people this payment covers: 1 at $50, 2 at $75. Suggested from
  -- the amount, always confirmable, and used for the headcount rather than
  -- inferring it from the money a second time.
  people         INTEGER NOT NULL DEFAULT 1,
  confirmed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_by   TEXT,
  PRIMARY KEY (event_id, transaction_id)
);

CREATE TABLE apex_club_events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  event_date   TEXT NOT NULL,
  -- The window transactions are drawn from. Defaults are applied in the
  -- worker, not here, so widening one event never rewrites another.
  window_start TEXT NOT NULL,
  window_end   TEXT NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
, price_single_cents INTEGER NOT NULL DEFAULT 5000, price_couple_cents INTEGER, flyer_r2_key TEXT, venue TEXT, start_time TEXT, speakers TEXT, registration_open INTEGER NOT NULL DEFAULT 1, calendar_clicks INTEGER NOT NULL DEFAULT 0, session_id TEXT);

CREATE TABLE apex_club_registrations (   id            TEXT PRIMARY KEY,   event_id      TEXT NOT NULL REFERENCES apex_club_events(id),   name          TEXT NOT NULL,   phone         TEXT NOT NULL,   rsvp_state    TEXT NOT NULL DEFAULT 'going'                 CHECK (rsvp_state IN ('going','next_time')),   confirmed_at  TEXT,   attended      INTEGER,   source        TEXT NOT NULL DEFAULT 'public',   created_at    TEXT NOT NULL DEFAULT (datetime('now')), plus_one INTEGER NOT NULL DEFAULT 0,   UNIQUE (event_id, phone) );

CREATE TABLE apex_contract_vendor_lines (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    recurrence TEXT NOT NULL,
    months INTEGER NOT NULL DEFAULT 1,
    vendor_cost_cents INTEGER,
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE apex_contracts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    seq INTEGER NOT NULL UNIQUE,
    number TEXT NOT NULL UNIQUE,
    package_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    data_json TEXT NOT NULL,
    total_cents INTEGER,
    public_token TEXT NOT NULL UNIQUE,
    snapshot_json TEXT,
    content_hash TEXT,
    company_signer_name TEXT,
    company_signed_at TEXT,
    company_signature_kind TEXT,
    company_signature_r2_key TEXT,
    company_signed_by TEXT,
    client_signatures_json TEXT,
    signed_at TEXT,
    sent_at TEXT,
    sent_by TEXT,
    first_viewed_at TEXT,
    last_viewed_at TEXT,
    document_id TEXT,
    terms_applied_at TEXT,
    terms_applied_by TEXT,
    void_reason TEXT,
    voided_at TEXT,
    voided_by TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE business_settings (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    zelle_qr_r2_key     TEXT,
    stripe_payment_link TEXT,
    updated_at          TEXT
, club_confirm_template TEXT, zelle_pay_url TEXT, zelle_handle TEXT);

CREATE TABLE client_package_terms (
  client_id TEXT PRIMARY KEY REFERENCES clients(id),
  package_id TEXT,
  pricing_option TEXT,
  base_total REAL,
  discount_type TEXT,
  discount_value REAL,
  discount_note TEXT,
  adjusted_total REAL,
  split_mode TEXT NOT NULL DEFAULT 'even',
  installment_count INTEGER,
  installment_amount REAL,
  custom_installments TEXT,
  recurrence_unit TEXT,
  recurrence_interval INTEGER,
  recurrence_never_ends INTEGER NOT NULL DEFAULT 1,
  is_new_client INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, payments_made_before INTEGER NOT NULL DEFAULT 0, first_due_date TEXT, recurrence_id TEXT);

CREATE TABLE client_payer_aliases (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id),
  -- normalizeMerchant() output for the payer, e.g. "ZELLE PAYMENT FROM
  -- BRAZILIAN INC". Unique so one payer can never map to two clients, which
  -- would make matching ambiguous in exactly the way the engine refuses.
  payer_key   TEXT NOT NULL UNIQUE,
  -- How the alias was created: 'approved' when learned from a match Alice
  -- confirmed, 'manual' if she ever enters one directly.
  source      TEXT NOT NULL DEFAULT 'approved'
              CHECK (source IN ('approved','manual')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);

CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, owners TEXT, industry TEXT, location TEXT, logo_url TEXT, profile_pt TEXT, profile_en TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), package TEXT, status TEXT DEFAULT 'active', phone TEXT, email TEXT, whatsapp TEXT, payment_method TEXT, contacts TEXT, digital_presence TEXT, zoho_customer_id TEXT, zelle_qr_r2_key TEXT, stripe_payment_link TEXT, consolidated INTEGER NOT NULL DEFAULT 0, lead_stage TEXT, stage_changed_at TEXT, next_step TEXT, next_step_set_by TEXT, next_step_set_at TEXT, language TEXT DEFAULT 'pt', referral_bg_color TEXT, referral_text_color TEXT, referred_by_partner_id TEXT, source_type TEXT, source_detail TEXT, stage_changed_by TEXT, stage_change_source TEXT, package_started_at TEXT, sunbiz_doc_number TEXT, instagram_handle TEXT, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, archived_by TEXT, legal_entity_name TEXT, legal_entity_ein TEXT, legal_entity_address TEXT, legal_entity_filed_at TEXT, legal_entity_status TEXT, legal_entity_officers TEXT, legal_entity_dba TEXT, legal_entity_dba_number TEXT, duns_number TEXT, legal_entity_source TEXT, legal_entity_verified_at TEXT, hide_logo INTEGER NOT NULL DEFAULT 0, timezone TEXT, billing_type TEXT NOT NULL DEFAULT 'billable' CHECK (billing_type IN ('billable','joint_venture','pro_bono','paid_in_full','not_billed')), custom_pricing INTEGER NOT NULL DEFAULT 0, daily_log_enabled INTEGER NOT NULL DEFAULT 1, daily_log_enabled_set_by TEXT DEFAULT NULL, daily_log_enabled_set_at TEXT DEFAULT NULL, goals_enabled INTEGER NOT NULL DEFAULT 1, goals_enabled_set_by TEXT DEFAULT NULL, goals_enabled_set_at TEXT DEFAULT NULL, daily_log_before_pause INTEGER DEFAULT NULL, goals_before_pause INTEGER DEFAULT NULL, lead_temperature TEXT);

CREATE TABLE doc_links (
  slug          TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  public_token  TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  title         TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE gm_referral_hits (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoice_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL
);

CREATE TABLE invoice_line_items (
  id                      TEXT PRIMARY KEY,
  invoice_id              TEXT NOT NULL REFERENCES invoices(id),
  kind                    TEXT NOT NULL CHECK (kind IN ('package', 'vendor_addon')),
  label                   TEXT NOT NULL,
  amount_cents            INTEGER NOT NULL,
  client_vendor_terms_id  TEXT REFERENCES client_vendor_terms(id)
);

CREATE TABLE "invoice_payments" (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL,
  transaction_id TEXT,
  amount_cents   INTEGER,
  matched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  match_type     TEXT NOT NULL DEFAULT 'manual' CHECK (match_type IN ('auto','suggested','manual','manual_no_txn')),
  note           TEXT,
  approved_by    TEXT,
  undone_at      TEXT,
  undone_by      TEXT
);

CREATE TABLE invoice_recurrence (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  amount_cents          INTEGER,
  interval_n            INTEGER NOT NULL DEFAULT 1,
  interval_unit         TEXT NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('day','week','month','year')),
  next_due_at           TEXT NOT NULL,
  end_after_n           INTEGER,
  generated_count       INTEGER NOT NULL DEFAULT 0,
  last_satisfied_period TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  client_id       TEXT,
  number          TEXT NOT NULL UNIQUE,
  amount_cents    INTEGER,
  issued_at       TEXT,
  due_at          TEXT,
  status          TEXT NOT NULL CHECK (status IN ('draft','sent','paid','void','voided_mistake')),
  sent_at         TEXT,
  paid_at         TEXT,
  voided_reason   TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  recurrence_id   TEXT,
  period_key      TEXT,
  zoho_invoice_id TEXT,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','zoho_migrated','recurrence')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, is_installment INTEGER NOT NULL DEFAULT 0, due_date_changed_at TEXT, due_date_changed_by TEXT, due_date_change_reason TEXT, claimed_paid_at   TEXT, claimed_paid_by   TEXT, claimed_paid_note TEXT, line_description TEXT);

CREATE TABLE packages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER
, short_name TEXT, full_name TEXT, audience TEXT, included_items TEXT, is_popular INTEGER NOT NULL DEFAULT 0, base_price    REAL, has_payment_plan INTEGER NOT NULL DEFAULT 0, installment_count  INTEGER, installment_amount REAL, upfront_price REAL, installment_total_price REAL, default_installment_count INTEGER, default_installment_amount REAL, duration_days INTEGER);

CREATE TABLE stripe_charges (
  id                     TEXT PRIMARY KEY,          -- ch_...
  payment_intent_id      TEXT,
  customer_id            TEXT,                      -- cus_..., NULL for a guest payment
  customer_name          TEXT,
  customer_email         TEXT,
  billing_name           TEXT,                      -- the cardholder, which is who actually paid
  description            TEXT,
  amount_cents           INTEGER NOT NULL,
  amount_refunded_cents  INTEGER NOT NULL DEFAULT 0,
  fee_cents              INTEGER,
  net_cents              INTEGER,
  currency               TEXT,
  status                 TEXT,                      -- succeeded | pending | failed
  created_at             TEXT,                      -- UTC, from Stripe's `created`
  invoice_id             TEXT,
  -- charge.metadata.client_id. Payment links Apex creates will stamp this, so
  -- future payments need no mapping at all. It wins over the customer map.
  metadata_client_id     TEXT,
  payout_id              TEXT,                      -- po_... the bank deposit it arrived in
  synced_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stripe_customer_clients (
  stripe_customer_id  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES clients(id),
  note                TEXT,                         -- the evidence
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stripe_payouts (
  id                   TEXT PRIMARY KEY,            -- po_...
  amount_cents         INTEGER NOT NULL,
  arrival_date         TEXT,                        -- YYYY-MM-DD
  status               TEXT,
  created_at           TEXT,
  charges_linked       INTEGER NOT NULL DEFAULT 0,  -- 1 once its charges were read
  bank_transaction_id  TEXT,                        -- transactions.id
  synced_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stripe_sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL,
  charges     INTEGER,
  payouts     INTEGER,
  linked      INTEGER,
  error       TEXT
);

CREATE TABLE transactions (
  id                           TEXT PRIMARY KEY,
  account_id                   TEXT NOT NULL,
  plaid_transaction_id         TEXT UNIQUE,
  pending_plaid_transaction_id TEXT,
  amount_cents                 INTEGER NOT NULL,
  date                         TEXT NOT NULL,
  posted_date                  TEXT,
  description                  TEXT,
  merchant_normalized          TEXT,
  category_id                  TEXT,
  is_transfer                  INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id             TEXT,
  transfer_status              TEXT NOT NULL DEFAULT 'none' CHECK (transfer_status IN ('none','suspected','confirmed','rejected')),
  pending                      INTEGER NOT NULL DEFAULT 0,
  raw_json                     TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
, category_source TEXT, categorized_at  TEXT, memo TEXT, categorized_by TEXT, voided_at TEXT, voided_reason TEXT, superseded_by TEXT);

CREATE INDEX idx_acct_item    ON accounts(plaid_item_id);

CREATE INDEX idx_acct_purpose ON accounts(purpose, status);

CREATE INDEX idx_acvl_contract ON apex_contract_vendor_lines (contract_id);

CREATE INDEX idx_acvl_vendor ON apex_contract_vendor_lines (vendor_id, active);

CREATE INDEX idx_apex_contracts_client ON apex_contracts (client_id);

CREATE INDEX idx_clients_referred_by ON clients (referred_by_partner_id);

CREATE INDEX idx_clients_source_type ON clients (source_type);

CREATE INDEX idx_club_dismissed_event ON apex_club_event_dismissed(event_id);

CREATE INDEX idx_club_reg_event ON apex_club_registrations(event_id);

CREATE INDEX idx_club_txns_event ON apex_club_event_txns(event_id);

CREATE UNIQUE INDEX idx_doc_links_token ON doc_links (kind, public_token);

CREATE INDEX idx_gmrh_ip ON gm_referral_hits (ip, created_at);

CREATE INDEX idx_gmrh_slug ON gm_referral_hits (slug, created_at);

CREATE INDEX idx_ili_cvt     ON invoice_line_items(client_vendor_terms_id);

CREATE INDEX idx_ili_invoice ON invoice_line_items(invoice_id);

CREATE INDEX idx_inv_client     ON invoices(client_id, status);

CREATE INDEX idx_inv_client_installment ON invoices(client_id, is_installment, status);

CREATE INDEX idx_inv_status_due ON invoices(status, due_at);

CREATE UNIQUE INDEX idx_inv_zoho ON invoices(zoho_invoice_id) WHERE zoho_invoice_id IS NOT NULL;

CREATE INDEX idx_pay_invoice ON invoice_payments(invoice_id, undone_at);

CREATE INDEX idx_pay_txn     ON invoice_payments(transaction_id, undone_at);

CREATE INDEX idx_payer_aliases_client ON client_payer_aliases(client_id);

CREATE INDEX idx_rec_active_due ON invoice_recurrence(active, next_due_at);

CREATE INDEX idx_rec_client     ON invoice_recurrence(client_id, active);

CREATE INDEX idx_stripe_charges_customer ON stripe_charges(customer_id);

CREATE INDEX idx_stripe_charges_payout   ON stripe_charges(payout_id);

CREATE INDEX idx_transactions_voided ON transactions(voided_at) WHERE voided_at IS NOT NULL;

CREATE INDEX idx_txn_account_date  ON transactions(account_id, date DESC);

CREATE INDEX idx_txn_amount_date   ON transactions(amount_cents, date);

CREATE INDEX idx_txn_category    ON transactions(category_id);

CREATE INDEX idx_txn_date          ON transactions(date DESC);

CREATE INDEX idx_txn_merchant    ON transactions(merchant_normalized);

CREATE INDEX idx_txn_pending_id    ON transactions(pending_plaid_transaction_id);

CREATE INDEX idx_txn_transfer      ON transactions(transfer_status, is_transfer);
