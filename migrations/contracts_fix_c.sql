-- Contracts fix build, checkpoint C (and the two columns checkpoint D needs,
-- so D adds no migration of its own). Additive only.
-- F18/F28: what a homeowner answered (contract change request / decline,
-- change order decline, before-photo or completion decline), for the owner's
-- Home card "Respostas dos clientes" until the owner marks it seen.
CREATE TABLE IF NOT EXISTS gm_homeowner_responses (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT,
  lead_id     TEXT,
  doc_kind    TEXT NOT NULL,          -- contract | change_order | ack_before_photos | ack_completion
  doc_id      TEXT NOT NULL,
  doc_number  TEXT,
  response    TEXT NOT NULL,          -- changes_requested | declined
  reason      TEXT,
  customer_name TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at     TEXT,
  seen_by     TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_homeowner_responses_client ON gm_homeowner_responses (client_id, seen_at);
-- F40: one notification per user per device. A duplicate subscription for the
-- same user and device is marked superseded (never deleted).
ALTER TABLE push_subscriptions ADD COLUMN superseded_at TEXT;
ALTER TABLE apns_device_tokens ADD COLUMN superseded_at TEXT;
-- F22: the salesperson routing message, editable like the other send messages.
ALTER TABLE gm_doc_settings ADD COLUMN contract_route_message TEXT;
-- F31 (checkpoint D): why an acknowledgment was voided (list_changed | replaced).
ALTER TABLE gm_job_acks ADD COLUMN void_reason TEXT;
-- F29 (checkpoint D): a punch item is removed with a reason and can be restored.
ALTER TABLE gm_job_punch_items ADD COLUMN removed_reason TEXT;
ALTER TABLE gm_job_punch_items ADD COLUMN removed_by TEXT;
