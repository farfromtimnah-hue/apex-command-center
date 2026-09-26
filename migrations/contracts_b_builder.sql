-- Contracts build, checkpoint B: contract settings, contracts, signing, events,
-- custom clauses. Additive only; nothing dropped. Money is integer cents.
-- Status is stored and every transition is guarded in SQL.
CREATE TABLE IF NOT EXISTS contract_client_settings (
  client_id            TEXT PRIMARY KEY,
  trades_json          TEXT,                 -- ["pools","tile","remodeling","hardscape","general"]
  builds_pools         INTEGER NOT NULL DEFAULT 0,
  defaults_json        TEXT,                 -- { "C01": "C01-A", ... } default option per clause area
  signers_json         TEXT,                 -- [{ "name": "...", "phone": "..." }] authorized signers besides the owner
  owner_signer_name    TEXT,                 -- the owner as printed on the signature line
  owner_signer_phone   TEXT,
  source               TEXT NOT NULL DEFAULT 'apex',  -- 'apex' | 'client' (client-private template, loaded by Apex)
  values_json          TEXT,                 -- Settings-source placeholders (work hours, notice days, warranty contact...)
  updated_by           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gm_contracts (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  job_id                TEXT NOT NULL,
  lead_id               TEXT,
  estimate_ids_json     TEXT,                -- accepted estimate ids the contract incorporates
  number                TEXT NOT NULL,       -- CON-0001 per client
  revision              INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'draft',
  -- draft | awaiting_company | company_signed | sent | viewed | homeowner_signed | completed |
  -- changes_requested | declined | expired | void | superseded
  library_version       INTEGER NOT NULL DEFAULT 1,
  template_scope        TEXT NOT NULL DEFAULT 'apex',
  selections_json       TEXT,                -- { area_id: option_id }  (option may be a client-private id)
  answers_json          TEXT,                -- builder answers, placeholder -> value
  flags_json            TEXT,                -- { sold_in_home, is_pool, property_type, pool_safety_feature, property_residential_1_4 }
  rules_json            TEXT,                -- computed: which locked blocks apply and why
  contract_amount_cents INTEGER NOT NULL DEFAULT 0,
  contract_date         TEXT,
  offer_expiry_date     TEXT,
  public_token          TEXT NOT NULL,
  disclaimer_line       TEXT,                -- frozen at company signing
  has_custom_clause     INTEGER NOT NULL DEFAULT 0,
  company_signer_name   TEXT, company_signer_phone TEXT,
  company_signed_at     TEXT, company_signature_kind TEXT, company_signature_r2_key TEXT,
  company_signed_ip     TEXT, company_signed_ua TEXT,
  company_signature_voided_at TEXT, company_signature_void_reason TEXT,
  routed_to_name        TEXT, routed_to_phone TEXT, routed_at TEXT, routed_by TEXT,
  sent_at               TEXT, sent_by TEXT, first_viewed_at TEXT, last_viewed_at TEXT,
  homeowner_signer_name TEXT, homeowner_signed_at TEXT, homeowner_signature_kind TEXT, homeowner_signature_r2_key TEXT,
  homeowner_signed_ip   TEXT, homeowner_signed_ua TEXT, homeowner_initials TEXT, marketing_consent INTEGER,
  lien_signed_at        TEXT, lien_signature_kind TEXT, lien_signature_r2_key TEXT,
  pool_ack_at           TEXT, pool_docs_delivery_json TEXT,
  cancellation_deadline TEXT,                -- YYYY-MM-DD, set when the homeowner signs (L5)
  transaction_date      TEXT,
  snapshot_r2_key       TEXT, content_hash TEXT,
  change_request_text   TEXT, decline_reason TEXT,
  created_by            TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason           TEXT, voided_by TEXT, voided_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_contracts_token ON gm_contracts (public_token);
CREATE INDEX IF NOT EXISTS idx_gm_contracts_job ON gm_contracts (client_id, job_id);
CREATE TABLE IF NOT EXISTS gm_contract_events (
  id          TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT,
  detail_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_contract_events_contract ON gm_contract_events (contract_id);
-- Custom clauses (B2): written once per clause area per contract; approved text is copied
-- into contract_clause_options with scope = client_id (never shared).
CREATE TABLE IF NOT EXISTS gm_contract_custom_clauses (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  contract_id   TEXT NOT NULL,
  area_id       TEXT NOT NULL,
  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | approved_with_edits | not_approved
  revised_text  TEXT,
  attorney_name TEXT, attorney_bar_number TEXT, attorney_review_date TEXT,
  reviewed_by   TEXT, reviewed_at TEXT,
  library_option_id TEXT,                          -- the client-private option created on approval
  created_by    TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Signers awaiting: the in-app "awaiting your signature" list reads gm_contracts where
-- status = 'awaiting_company' and routed_to_name matches the session.
-- The contract send message joins the estimate / invoice / receipt templates.
ALTER TABLE gm_doc_settings ADD COLUMN contract_message TEXT;
