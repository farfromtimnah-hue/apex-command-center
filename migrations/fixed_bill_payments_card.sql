-- Add 'credit_card' as a payment method on a bill payment.
--
-- Nicole 2026-08-19: when money is tight Alice sometimes pays a bill with
-- the credit card. That still clears the bill for the month (it must leave
-- the overdue list), but it did NOT come out of the bank -- so it needs to
-- be recorded distinctly from a normal manual payment.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt. Rows are
-- preserved.
CREATE TABLE fixed_bill_payments_new (
  id             TEXT PRIMARY KEY,
  bill_id        TEXT NOT NULL REFERENCES fixed_bills(id),
  period_key     TEXT NOT NULL,
  paid_at        TEXT,
  amount_cents   INTEGER,
  transaction_id TEXT REFERENCES transactions(id),
  match_type     TEXT NOT NULL DEFAULT 'manual'
                 CHECK (match_type IN ('manual', 'bank_matched', 'credit_card')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bill_id, period_key)
);
INSERT INTO fixed_bill_payments_new
  SELECT id, bill_id, period_key, paid_at, amount_cents, transaction_id, match_type, created_at
  FROM fixed_bill_payments;
DROP TABLE fixed_bill_payments;
ALTER TABLE fixed_bill_payments_new RENAME TO fixed_bill_payments;
