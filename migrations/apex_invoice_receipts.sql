-- ---------------------------------------------------------------------------
-- Apex's OWN invoices get receipts too.
--
-- Additive only. invoice_payments grows the columns a real accounting event
-- needs (method, paid_date, reference, receipt identity, frozen balances)
-- without touching the existing rows written by bank matching or
-- applyStripeChargesToApexInvoices -- those keep working unchanged, and later
-- gain a receipt through the same record-payment/issue-receipt machinery
-- (COMMIT 4), never a guess.
-- ---------------------------------------------------------------------------
ALTER TABLE invoice_payments ADD COLUMN method TEXT;
ALTER TABLE invoice_payments ADD COLUMN paid_date TEXT;
ALTER TABLE invoice_payments ADD COLUMN reference TEXT;
ALTER TABLE invoice_payments ADD COLUMN receipt_number TEXT;
ALTER TABLE invoice_payments ADD COLUMN receipt_token TEXT;
ALTER TABLE invoice_payments ADD COLUMN receipt_issued_at TEXT;
ALTER TABLE invoice_payments ADD COLUMN recorded_by TEXT;
-- Frozen at the moment the receipt is issued (A6-style freeze, same idea as
-- gm_invoice_payments.balance_after_cents): a later payment on the same
-- invoice must never change what an already-issued receipt says.
ALTER TABLE invoice_payments ADD COLUMN balance_before_cents INTEGER;
ALTER TABLE invoice_payments ADD COLUMN balance_after_cents INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_receipt_number ON invoice_payments(receipt_number) WHERE receipt_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_receipt_token  ON invoice_payments(receipt_token)  WHERE receipt_token  IS NOT NULL;

-- ---------------------------------------------------------------------------
-- apex_receipt_counter: single-row allocator for RCT-###### numbers, same
-- compare-and-set idiom as invoice_counter. Global, not per-client: Apex's
-- own invoices are not client-scoped the way growth-management documents
-- are, and gm_doc_counters' RCT kind formats 4 digits (RCT-0001), not the
-- 6-digit RCT-000001 shape Apex's own receipts need.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS apex_receipt_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL
);
INSERT INTO apex_receipt_counter (id, next_number) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;
