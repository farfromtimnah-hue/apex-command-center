-- Per-client real payment terms, separate from the package's list prices.
-- Run against the live D1 database: apex-command-center

CREATE TABLE IF NOT EXISTS client_package_terms (
  client_id TEXT PRIMARY KEY REFERENCES clients(id),
  package_id TEXT,
  pricing_option TEXT,
  base_total REAL,
  discount_type TEXT,
  discount_value REAL,
  discount_note TEXT,
  adjusted_total REAL,
  split_mode TEXT NOT NULL DEFAULT 'even',
  installment_count INTEGER,
  installment_amount REAL,
  custom_installments TEXT,
  recurrence_unit TEXT,
  recurrence_interval INTEGER,
  recurrence_never_ends INTEGER NOT NULL DEFAULT 1,
  is_new_client INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
