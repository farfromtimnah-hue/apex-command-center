-- ---------------------------------------------------------------------------
-- A cash payment on one of Apex's OWN invoices is real money in, so it has to
-- clear the books the same way a bank deposit does: a transactions row on a
-- dedicated synthetic "cash on hand" account. No Plaid ids on this account,
-- ever -- the 4-hour sync loop and anything that calls Plaid must skip it.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO accounts (id, plaid_item_id, plaid_account_id, institution, name, mask, subtype, purpose, balance_cents, available_cents, status)
VALUES ('apex-cash', NULL, NULL, 'Cash', 'Cash on hand', NULL, NULL, 'business', NULL, NULL, 'active');

-- The record-payment route's double-submit guard: INSERT OR IGNORE on this
-- unique key means a double tap can never create two payment rows, race or
-- no race -- the guard is the write itself, not a SELECT-then-INSERT check.
ALTER TABLE invoice_payments ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_dedupe ON invoice_payments(dedupe_key) WHERE dedupe_key IS NOT NULL;
