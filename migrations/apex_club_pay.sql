-- Apex Club payments: card price per event, per-guest pay link, paid state,
-- Zelle confirmation number (2026-10-04). Applied by hand:
--   npx wrangler d1 execute apex-command-center --remote --file migrations/apex_club_pay.sql
-- Check PRAGMA table_info first and skip any ALTER whose column already
-- exists. Nothing is backfilled: an older registration gets its pay_token the
-- first time staff ask for its payment link.
--
-- price_single_cents / price_couple_cents keep their meaning: what a guest
-- pays by Zelle or cash (the bank-deposit suggester matches on them). The
-- card price is the POSTED price; NULL means card is not offered. When only
-- the single card price is set, a couple pays twice that.
ALTER TABLE apex_club_events ADD COLUMN price_card_single_cents INTEGER;
ALTER TABLE apex_club_events ADD COLUMN price_card_couple_cents INTEGER;

ALTER TABLE apex_club_registrations ADD COLUMN pay_token TEXT;
ALTER TABLE apex_club_registrations ADD COLUMN paid_at TEXT;
ALTER TABLE apex_club_registrations ADD COLUMN paid_cents INTEGER;
-- card, zelle or manual
ALTER TABLE apex_club_registrations ADD COLUMN paid_method TEXT;
-- the Stripe charge id, or the bank transaction id
ALTER TABLE apex_club_registrations ADD COLUMN paid_ref TEXT;
ALTER TABLE apex_club_registrations ADD COLUMN zelle_conf TEXT;
ALTER TABLE apex_club_registrations ADD COLUMN zelle_conf_at TEXT;
-- pending, review or mismatch
ALTER TABLE apex_club_registrations ADD COLUMN zelle_state TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_reg_pay_token ON apex_club_registrations(pay_token) WHERE pay_token IS NOT NULL;

-- A Stripe charge marks a registration paid exactly once (primary key).
CREATE TABLE IF NOT EXISTS apex_club_stripe_applied (
  charge_id       TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  applied_cents   INTEGER NOT NULL,
  applied_at      TEXT NOT NULL
);

-- One active Stripe payment link per registration.
CREATE TABLE IF NOT EXISTS apex_club_pay_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id TEXT NOT NULL,
  stripe_link_id  TEXT,
  stripe_price_id TEXT,
  url             TEXT,
  amount_cents    INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  deactivated_at  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apex_club_pay_links_active ON apex_club_pay_links(registration_id) WHERE active = 1;

-- A Zelle confirmation number can claim one registration, ever (primary key).
CREATE TABLE IF NOT EXISTS apex_club_conf_used (
  conf            TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  transaction_id  TEXT,
  used_at         TEXT NOT NULL
);
