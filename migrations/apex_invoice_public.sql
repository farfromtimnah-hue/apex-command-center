-- Public Apex invoice page, Stripe pay links and the two feature switches
-- (2026-10-04). Applied by hand:
--   npx wrangler d1 execute apex-command-center --remote --file migrations/apex_invoice_public.sql
-- Check PRAGMA table_info for each table first and skip any ALTER whose
-- column already exists (SQLite has no ADD COLUMN IF NOT EXISTS).
-- Nothing is backfilled: tokens are minted one invoice at a time, when staff
-- ask for that invoice's client link.

-- The client's link token (48 hex) and view tracking.
ALTER TABLE invoices ADD COLUMN public_token TEXT;
ALTER TABLE invoices ADD COLUMN first_viewed_at TEXT;
ALTER TABLE invoices ADD COLUMN last_viewed_at TEXT;
ALTER TABLE invoices ADD COLUMN view_count INTEGER DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token) WHERE public_token IS NOT NULL;

-- Per client: 1 shows a card button on that client's invoice page.
ALTER TABLE clients ADD COLUMN invoice_card_enabled INTEGER DEFAULT 0;

-- What a Stripe charge was for, read from its metadata by the sync.
ALTER TABLE stripe_charges ADD COLUMN metadata_invoice_id TEXT;
ALTER TABLE stripe_charges ADD COLUMN metadata_club_reg_id TEXT;
ALTER TABLE stripe_charges ADD COLUMN pm_type TEXT;

-- The two master switches. Both ship 0.
ALTER TABLE business_settings ADD COLUMN client_invoice_link_enabled INTEGER DEFAULT 0;
ALTER TABLE business_settings ADD COLUMN club_pay_enabled INTEGER DEFAULT 0;

-- One active Stripe payment link per invoice and kind. A link is fresh only
-- while amount_cents equals the invoice's current balance.
CREATE TABLE IF NOT EXISTS apex_invoice_pay_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('card','ach')),
  stripe_link_id  TEXT,
  stripe_price_id TEXT,
  url             TEXT,
  amount_cents    INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  deactivated_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apex_invoice_pay_links_active ON apex_invoice_pay_links(invoice_id, kind) WHERE active = 1;

-- The guard that a Stripe charge is applied to an invoice exactly once: the
-- primary key on charge_id. INSERT OR IGNORE here comes before any payment row.
CREATE TABLE IF NOT EXISTS apex_stripe_applied (
  charge_id     TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL,
  applied_cents INTEGER NOT NULL,
  applied_at    TEXT NOT NULL
);

-- A short lock so two requests never regenerate the same pay links at once.
-- One row per invoice (or Club registration), reused: taking the lock is one
-- guarded upsert on the primary key, releasing it is an UPDATE. Never deleted.
CREATE TABLE IF NOT EXISTS apex_pay_link_locks (
  lock_key     TEXT PRIMARY KEY,
  locked_until TEXT NOT NULL
);
