-- Contracts build, checkpoint C: signed change orders and the no-contract notice.
CREATE TABLE IF NOT EXISTS gm_change_orders (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  job_id                TEXT NOT NULL,
  lead_id               TEXT,
  contract_id           TEXT,                 -- NULL on an estimate-only job
  number                TEXT NOT NULL,        -- CO-0001 per client
  status                TEXT NOT NULL DEFAULT 'draft',   -- draft | company_signed | sent | viewed | completed | declined | void
  description           TEXT,
  items_json            TEXT,                 -- [{pricing_id,item_name,qty,unit,rate_cents,amount_cents,kind:'add'|'remove',material_cost_cents,labor_cost_cents,other_cost_cents}]
  amount_cents          INTEGER NOT NULL DEFAULT 0,      -- signed: removals are credits
  price_before_cents    INTEGER NOT NULL DEFAULT 0,
  price_after_cents     INTEGER NOT NULL DEFAULT 0,
  schedule_days         INTEGER NOT NULL DEFAULT 0,
  payment_change        TEXT NOT NULL DEFAULT 'adjust_remaining',  -- adjust_remaining | new_step
  payment_note          TEXT,
  public_token          TEXT NOT NULL,
  company_signer_name   TEXT, company_signed_at TEXT, company_signature_kind TEXT, company_signature_r2_key TEXT, company_signed_ip TEXT, company_signed_ua TEXT,
  routed_to_name TEXT, routed_to_phone TEXT, routed_at TEXT,
  sent_at TEXT, first_viewed_at TEXT,
  homeowner_signer_name TEXT, homeowner_signed_at TEXT, homeowner_signature_kind TEXT, homeowner_signature_r2_key TEXT, homeowner_signed_ip TEXT, homeowner_signed_ua TEXT,
  snapshot_r2_key TEXT, content_hash TEXT, applied_at TEXT, applied_json TEXT,
  decline_reason TEXT, void_reason TEXT, voided_by TEXT, voided_at TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_change_orders_token ON gm_change_orders (public_token);
CREATE INDEX IF NOT EXISTS idx_gm_change_orders_job ON gm_change_orders (client_id, job_id);
-- No signed contract on a job over $2,500: one open notice per job until resolved.
CREATE TABLE IF NOT EXISTS gm_contract_notices (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  opened_by      TEXT, opened_role TEXT, trigger_action TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT, resolution TEXT, resolved_by TEXT,     -- contract_signed | owner_continued | job_closed
  taps_json      TEXT                                         -- [{actor, role, at, action}] seller "notify owner" taps and owner button taps
);
CREATE INDEX IF NOT EXISTS idx_gm_contract_notices_job ON gm_contract_notices (client_id, job_id);
