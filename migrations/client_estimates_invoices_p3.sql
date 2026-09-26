-- Client portal estimates & invoices — PHASE 3: invoices, payments, receipts.
-- Money is integer cents. Nothing is deleted: a payment is reversed, an
-- invoice is voided, both with a stored reason. Status of an invoice is
-- DERIVED at read time (unpaid / partially paid / paid / overdue / pending
-- verification); only draft | sent | void are stored.

CREATE TABLE IF NOT EXISTS gm_invoices (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  lead_id          TEXT,
  estimate_id      TEXT,                       -- the accepted estimate the schedule came from
  number           TEXT NOT NULL,              -- INV-0001 per client
  step_label       TEXT,                       -- the payment-schedule step (Deposit, Completion...)
  step_pct         REAL,
  status           TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | void
  issue_date       TEXT,                       -- YYYY-MM-DD
  due_date         TEXT,                       -- YYYY-MM-DD
  amount_cents     INTEGER NOT NULL DEFAULT 0, -- sum of gm_invoice_items
  public_token     TEXT NOT NULL,
  sent_at          TEXT,
  first_viewed_at  TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason      TEXT,
  voided_by        TEXT,
  voided_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_invoices_token ON gm_invoices (public_token);
CREATE INDEX IF NOT EXISTS idx_gm_invoices_client ON gm_invoices (client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gm_invoices_job ON gm_invoices (job_id);

CREATE TABLE IF NOT EXISTS gm_invoice_items (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL,
  description   TEXT NOT NULL,
  qty           REAL NOT NULL DEFAULT 1,
  unit          TEXT,
  rate_cents    INTEGER NOT NULL DEFAULT 0,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,                          -- why a line was added after creation (late fee)
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gm_invoice_items_inv ON gm_invoice_items (invoice_id, sort_order);

-- A payment recorded by hand. Seller-recorded rows start pending_verification
-- and never count as paid until the owner verifies them; owner/admin rows are
-- verified at once and get a receipt number. Reversal keeps the row.
CREATE TABLE IF NOT EXISTS gm_invoice_payments (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  paid_date         TEXT,                      -- YYYY-MM-DD
  method            TEXT NOT NULL,             -- zelle | check | cash | money_order | bank_transfer | card | other
  reference         TEXT,
  note              TEXT,
  state             TEXT NOT NULL DEFAULT 'pending_verification',  -- pending_verification | verified | rejected | reversed
  recorded_by       TEXT,
  recorded_by_role  TEXT,                      -- owner | seller | admin
  recorded_at       TEXT NOT NULL DEFAULT (datetime('now')),
  verified_by       TEXT,
  verified_at       TEXT,
  reject_reason     TEXT,
  reversed_by       TEXT,
  reversed_at       TEXT,
  reverse_reason    TEXT,
  receipt_number    TEXT,                      -- RCT-0001, issued on verification
  receipt_token     TEXT                       -- public token for receipt-view (the token is the credential)
);
CREATE INDEX IF NOT EXISTS idx_gm_invoice_payments_inv ON gm_invoice_payments (invoice_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_gm_invoice_payments_client ON gm_invoice_payments (client_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_invoice_payments_receipt_token ON gm_invoice_payments (receipt_token);

-- Credits reduce what is owed (an allowance that came in under budget);
-- refunds record money returned against a verified payment.
CREATE TABLE IF NOT EXISTS gm_invoice_credits (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- credit | refund
  number        TEXT NOT NULL,                 -- CR-0001 | REF-0001
  amount_cents  INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  payment_id    TEXT,                          -- refunds: the payment the money was returned against
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_invoice_credits_inv ON gm_invoice_credits (invoice_id, created_at);
