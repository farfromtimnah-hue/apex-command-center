-- Reworks the manual-paid button added in 0003. Nicole's call 2026-08-17:
-- the button should NOT touch status or invoice_payments at all -- it's a
-- mental note for Alice ("I believe this is paid"), not an accounting event.
-- The invoice stays 'sent', stays in outstanding totals, and only actually
-- closes when the real bank transaction syncs in and gets matched.
--
-- 0003's 'manual_no_txn' match_type is no longer written by anything as of
-- this migration -- kept in the CHECK constraint rather than stripped out,
-- since removing a CHECK value on a column with a NOT NULL default requires
-- yet another table rebuild for zero benefit, and no code path uses it going
-- forward. Existing manual_no_txn rows, if any were written between 0003 and
-- this migration, are left as-is; they are historical financial fact (money
-- was recorded against an invoice) and rewriting them would be worse than
-- leaving the label a little wider than currently used.
--
-- claimed_paid_at / claimed_paid_by / claimed_paid_note carry the "I saw the
-- deposit" tag as its own thing, deliberately not reusing paid_at/status so
-- there is never a moment where an unconfirmed claim reads as closed.
ALTER TABLE invoices ADD COLUMN claimed_paid_at   TEXT;
ALTER TABLE invoices ADD COLUMN claimed_paid_by   TEXT;
ALTER TABLE invoices ADD COLUMN claimed_paid_note TEXT;
