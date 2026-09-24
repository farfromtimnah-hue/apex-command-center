-- Stripe payment sync (2026-09-23).
--
-- WHY: the bank only ever sees a Stripe PAYOUT -- one lump deposit reading
-- "Transfer STRIPE ; APEX BUSINESS", with no customer name. So a client who
-- pays by card (General Tile, a $1,437/month subscription) showed $0 paid,
-- and the one time a payout was matched to them by amount, Alice correctly
-- undid it: DFN owes the same monthly figure, so the amount proves nothing.
-- Stripe's own API knows who paid. These tables hold what it says.

-- One row per Stripe charge. Refreshed on every sync (upsert), so refunds and
-- status changes land without a separate path.
CREATE TABLE IF NOT EXISTS stripe_charges (
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
CREATE INDEX IF NOT EXISTS idx_stripe_charges_customer ON stripe_charges(customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_charges_payout   ON stripe_charges(payout_id);

-- Which Apex client a Stripe customer is. Set ONCE per customer, by a person
-- or from evidence -- never inferred from a name or an amount (a name match is
-- not identity, and two clients owe $1,397/month).
CREATE TABLE IF NOT EXISTS stripe_customer_clients (
  stripe_customer_id  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES clients(id),
  note                TEXT,                         -- the evidence
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per payout, linked to the bank deposit it became. That link is what
-- lets contract progress skip the deposit (it is counted through its charges)
-- and what explains a "Transfer STRIPE" line without anyone asking Alice.
CREATE TABLE IF NOT EXISTS stripe_payouts (
  id                   TEXT PRIMARY KEY,            -- po_...
  amount_cents         INTEGER NOT NULL,
  arrival_date         TEXT,                        -- YYYY-MM-DD
  status               TEXT,
  created_at           TEXT,
  charges_linked       INTEGER NOT NULL DEFAULT 0,  -- 1 once its charges were read; 2 = manual payout, Stripe cannot itemise it
  bank_transaction_id  TEXT,                        -- transactions.id
  synced_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Last run, so a silently dead sync is visible.
CREATE TABLE IF NOT EXISTS stripe_sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL,
  charges     INTEGER,
  payouts     INTEGER,
  linked      INTEGER,
  error       TEXT
);
