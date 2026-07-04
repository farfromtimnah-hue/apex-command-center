-- Financial Health tables

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  transaction_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  suggested_category TEXT,
  confidence TEXT NOT NULL DEFAULT 'media' CHECK (confidence IN ('alta', 'media', 'baixa')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored')),
  assigned_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  monthly_cost REAL NOT NULL,
  next_renewal_date TEXT NOT NULL,
  manage_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
