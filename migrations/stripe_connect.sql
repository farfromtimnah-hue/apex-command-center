-- Card payments on client invoices (Stripe Connect), 2026-10-03.
CREATE TABLE IF NOT EXISTS gm_stripe_accounts (
  client_id TEXT PRIMARY KEY,
  stripe_account_id TEXT NOT NULL,
  charges_enabled INTEGER NOT NULL DEFAULT 0,
  details_submitted INTEGER NOT NULL DEFAULT 0,
  livemode INTEGER NOT NULL DEFAULT 0,
  connected_by TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_stripe_accounts_acct ON gm_stripe_accounts (stripe_account_id);
CREATE TABLE IF NOT EXISTS gm_stripe_events (
  event_id TEXT PRIMARY KEY,
  client_id TEXT,
  invoice_id TEXT,
  created_at TEXT
);
