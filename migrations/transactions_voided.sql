-- Voided transactions -- a row the bank retired that we deliberately KEEP.
--
-- Plaid puts a transaction in its `removed` list when it retires that id. The
-- usual cause is a PENDING charge settling and being reissued as a posted
-- transaction under a brand-new transaction_id. The old row is then a GHOST:
-- the money it describes never left the account a second time.
--
-- Deleting the ghost is not safe. Three tables carry a foreign key onto
-- transactions(id) -- apex_club_event_txns, apex_club_event_dismissed, and
-- fixed_bill_payments.transaction_id -- so once Alice has matched a charge to
-- a bill, DELETE fails on a FOREIGN KEY constraint and takes the WHOLE sync
-- down with it. That is exactly what happened on 2026-08-21 to a $712.95
-- Toyota Sienna car payment.
--
-- Keeping the ghost untouched is not safe either. NO money query in the worker
-- filters on `pending`, so a stale pending row is counted in her spending
-- totals, her budgets, her bill matching and her variable-spend estimates --
-- the Sienna payment showed up TWICE on an account with $76.01 available.
--
-- So: keep the row, record why it died, and exclude it from the money.
--
--   voided_at     -- when we voided it. NULL means a live, ordinary row.
--   voided_reason -- 'superseded' (a posted row replaced it) or 'removed'
--                    (Plaid retired it with no successor we could identify).
--   superseded_by -- the transactions.id that replaced it, when we know it.
--                    NULL for 'removed'. This is what preserves the audit
--                    trail: from the ghost you can always reach the real one.
--
-- A voided row is NEVER deleted and never edited beyond these three columns.
-- Its date, amount, description and raw_json stay exactly as the bank sent
-- them, because the point is to have a record of what happened.
--
-- IMPORTANT for future work: every money query must carry `voided_at IS NULL`.
-- The transfer exclusions (`is_transfer = 0`, `transfer_status NOT IN
-- (...)`) are the precedent to follow -- grep those and you have the full set
-- of sites. A reader that forgets this filter silently double-counts, which is
-- the bug this column exists to end.

ALTER TABLE transactions ADD COLUMN voided_at     TEXT;
ALTER TABLE transactions ADD COLUMN voided_reason TEXT;
ALTER TABLE transactions ADD COLUMN superseded_by TEXT;

-- Partial index: the money queries all filter voided_at IS NULL, and live rows
-- are the overwhelming majority, so index the small voided set instead.
CREATE INDEX IF NOT EXISTS idx_transactions_voided
  ON transactions(voided_at) WHERE voided_at IS NOT NULL;
