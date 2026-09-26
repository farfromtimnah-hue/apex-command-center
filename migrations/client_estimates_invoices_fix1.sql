-- Client portal estimates & invoices — FIX BUILD 1 (after the 2026-09-26
-- click-through). Additive only; nothing dropped.
--
-- gm_invoice_payments: a receipt must freeze its numbers at verification.
--   balance_before_cents / balance_after_cents: the invoice balance right
--   before and right after THIS payment counted, stored when it is verified.
--   contract_remaining_after_cents: remaining contract balance at that moment.
-- gm_invoices: late fees are simple interest on the unpaid PRINCIPAL only,
--   for days not already charged.
--   late_fee_cents: the sum of late-fee lines already added (part of amount_cents).
--   late_fee_through: the last day interest has been charged up to (YYYY-MM-DD).
-- gm_invoice_items.item_kind: NULL for a normal line, 'late_fee' for a fee line.
ALTER TABLE gm_invoice_payments ADD COLUMN balance_before_cents INTEGER;
ALTER TABLE gm_invoice_payments ADD COLUMN balance_after_cents INTEGER;
ALTER TABLE gm_invoice_payments ADD COLUMN contract_remaining_after_cents INTEGER;
ALTER TABLE gm_invoices ADD COLUMN late_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_invoices ADD COLUMN late_fee_through TEXT;
ALTER TABLE gm_invoice_items ADD COLUMN item_kind TEXT;
