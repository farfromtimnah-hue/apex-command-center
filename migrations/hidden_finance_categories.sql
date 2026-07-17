-- Categories Alice/Rafa have chosen to hide from the Reconciliation tab's
-- folder view. Purely a display preference for that one UI -- never touches
-- the real Zoho chart of accounts, and every other reader of chart-of-accounts
-- data (expense-add Category dropdown, Tax Summary, etc.) ignores this table.
CREATE TABLE IF NOT EXISTS hidden_finance_categories (
  category_account_id TEXT PRIMARY KEY,
  hidden_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
