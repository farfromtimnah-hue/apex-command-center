-- Tap to Pay on iPhone, Stripe side (2026-10-18). Additive only.
-- One Terminal location per connected business, and the owner's own
-- consent to use Tap to Pay with their own Stripe account.
CREATE TABLE IF NOT EXISTS gm_stripe_terminal_locations (
  client_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  created_at TEXT
);
ALTER TABLE gm_stripe_accounts ADD COLUMN tap_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_stripe_accounts ADD COLUMN tap_accepted_at TEXT;
ALTER TABLE gm_stripe_accounts ADD COLUMN tap_accepted_by TEXT;
