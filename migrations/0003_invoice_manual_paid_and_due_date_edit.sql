-- Two gaps found live 2026-08-17 while checking why JM Luxury Pools' $4,000
-- deposit wasn't matching: (1) there was no way to mark an invoice paid
-- without a synced bank transaction to point at, and (2) no way to push a
-- due date out after sending, which clients had already been asking for.

-- 1. Manual payment confirmation with no bank transaction.
--
-- invoice_payments.transaction_id was NOT NULL, which is correct for every
-- existing path (auto-match, suggested, manual-from-a-real-transaction) but
-- has no room for "Alice can see the deposit in BofA and the account total
-- already reflects it, but /transactions/sync hasn't surfaced the row yet."
-- That gap is real -- Plaid's balance and transaction-sync calls are
-- independent, and a large or recent deposit can post to one before the
-- other. SQLite has no ALTER COLUMN, so this rebuilds the table.
--
-- match_type gains 'manual_no_txn' so these rows are always distinguishable
-- from a real bank-matched payment in the audit trail -- reusing 'manual'
-- would blur two very different confidence levels.
--
-- note holds why: "Alice confirmed via her BofA app, bank hasn't synced yet."
-- Required at the API layer (not this schema) so a manual override always
-- carries a stated reason, same house rule as voided_reason.

CREATE TABLE invoice_payments_new (
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

INSERT INTO invoice_payments_new
  (id, invoice_id, transaction_id, amount_cents, matched_at, match_type, approved_by, undone_at, undone_by)
SELECT id, invoice_id, transaction_id, amount_cents, matched_at, match_type, approved_by, undone_at, undone_by
FROM invoice_payments;

DROP TABLE invoice_payments;
ALTER TABLE invoice_payments_new RENAME TO invoice_payments;

CREATE INDEX IF NOT EXISTS idx_pay_invoice ON invoice_payments(invoice_id, undone_at);
CREATE INDEX IF NOT EXISTS idx_pay_txn     ON invoice_payments(transaction_id, undone_at);

-- 2. Due-date edits after sending.
--
-- Last-change-only, mirroring how this table already tracks voided_at/by
-- rather than a separate history table -- consistent with the rest of the
-- schema's audit style, and due-date pushes are rare enough per invoice that
-- a full log is not worth the extra join everywhere due_at is read.
ALTER TABLE invoices ADD COLUMN due_date_changed_at TEXT;
ALTER TABLE invoices ADD COLUMN due_date_changed_by TEXT;
ALTER TABLE invoices ADD COLUMN due_date_change_reason TEXT;
