-- Starting balance per client (Financeiro tab, "Saldo de abertura").
-- Run ONCE. Two nullable columns on gm_config; do not rebuild the table.
-- A second run fails with "duplicate column name", which is harmless.
--   opening_balance_cents  whole cents the business already had (may be negative)
--   opening_balance_month  the month it applies to, always the first day (YYYY-MM-01)
-- NULL in both means no starting balance: the earliest month opens at 0.
-- The app answers opening_balance_available = false until this has been run.

ALTER TABLE gm_config ADD COLUMN opening_balance_cents INTEGER;
ALTER TABLE gm_config ADD COLUMN opening_balance_month TEXT;
