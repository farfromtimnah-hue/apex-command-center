-- Plain-English custom labels ("AKA") Alice/Rafa can set per Zoho
-- chart-of-accounts category, shown in place of the real Zoho account name
-- everywhere a Reconciliation folder name is displayed. Purely a display
-- substitution -- category_account_id (the real Zoho account used to
-- categorize a transaction) is completely unaffected. Same convention as
-- hidden_finance_categories: a display-preference table, never touches the
-- real Zoho chart of accounts.
CREATE TABLE IF NOT EXISTS finance_category_labels (
  category_account_id TEXT PRIMARY KEY,
  custom_label         TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
