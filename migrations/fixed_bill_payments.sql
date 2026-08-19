-- Payment tracking, priority ordering, and coverage-forecast support for
-- fixed_bills. Spec: apex-bills-overdue-priority-spec.md (2026-08-19).
--
-- Context: clients delaying payment to Apex has rippled into Alice's personal
-- finances. She needs to see, at a glance, what bills are overdue, in what
-- order she should actually pay them, and whether money already expected
-- from client invoices will cover them.

ALTER TABLE fixed_bills ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'manual'
  CHECK (payment_method IN ('draft', 'manual'));

-- Clickable, shown especially when the bill is overdue -- that's the moment
-- she needs the link most.
ALTER TABLE fixed_bills ADD COLUMN pay_url TEXT;

-- Account numbers / payment references. Separate from the existing generic
-- `notes` column so this doesn't get lost in freeform notes.
ALTER TABLE fixed_bills ADD COLUMN payee_notes TEXT;

-- Lower = more important. Set via drag-drop on the overdue section, reused
-- every month. NULL = unranked, falls to the bottom (sorted by day_of_month
-- as secondary key) so a newly added bill isn't silently invisible.
ALTER TABLE fixed_bills ADD COLUMN priority_rank INTEGER;

-- normalizeMerchant() output for this bill's outgoing payment, same shape as
-- client_payer_aliases.payer_key. NULL until a payment is matched/confirmed
-- once; set on first confirmation, learn-once-reuse-forever.
ALTER TABLE fixed_bills ADD COLUMN payer_match_pattern TEXT;

-- Tracks paid status per calendar period, not just "is this bill fixed" -- a
-- fixed bill recurs monthly, so paid status must be scoped to a period. This
-- mirrors why invoices are separate rows per period rather than one mutable
-- row per client.
CREATE TABLE IF NOT EXISTS fixed_bill_payments (
  id             TEXT PRIMARY KEY,
  bill_id        TEXT NOT NULL REFERENCES fixed_bills(id),
  period_key     TEXT NOT NULL,          -- 'YYYY-MM', the month this payment covers
  paid_at        TEXT,
  amount_cents   INTEGER,
  transaction_id TEXT REFERENCES transactions(id),   -- NULL if manual, set if bank-matched
  match_type     TEXT NOT NULL DEFAULT 'manual' CHECK (match_type IN ('manual', 'bank_matched')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bill_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_fixed_bill_payments_bill ON fixed_bill_payments(bill_id, period_key);
CREATE INDEX IF NOT EXISTS idx_fixed_bills_priority ON fixed_bills(priority_rank);
