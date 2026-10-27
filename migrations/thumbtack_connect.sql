-- Thumbtack lead connection (Partner API, 2026-10-27).
--
-- A business connects its Thumbtack account in the portal (Estimates >
-- Settings), and every Thumbtack lead (a "negotiation") lands in its pipeline
-- by itself. Modelled on migrations/meta_lead_ads.sql.
--
-- ADD-ONLY. Nothing existing is changed or deleted.
--
-- ORDER: deploy the Worker FIRST or AFTER, either is safe. Without these
-- tables the Worker reads the feature as "not available yet", the owner routes
-- answer with that message, and the webhook answers 503 (so Thumbtack can send
-- the lead again). Nothing else in the Worker reads these tables.
--
-- Run each statement once. An ALTER fails with "duplicate column name" if it
-- is run a second time; that error is harmless.

-- 1. One connection per business. Both tokens are SEALED (tokenSeal,
--    "enc:v1:") and never leave the Worker.
--      thumbtack_user_id  the Thumbtack user who signed in (GET /v4/users/self)
--      connected_by       the display name of the portal login that connected
--      connected_login    that login (username or email)
--      needs_reconnect    1 when Thumbtack refused the token and a refresh failed
--      reconnect_pushed_at  set when the owner was told, so they are told once
CREATE TABLE IF NOT EXISTS gm_thumbtack_connections (
  client_id            TEXT PRIMARY KEY,
  token_sealed         TEXT NOT NULL,
  refresh_sealed       TEXT,
  token_expires_at     TEXT,
  thumbtack_user_id    TEXT,
  connected_by         TEXT,
  connected_login      TEXT,
  connected_at         TEXT NOT NULL DEFAULT (datetime('now')),
  needs_reconnect      INTEGER NOT NULL DEFAULT 0,
  reconnect_pushed_at  TEXT,
  last_error           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. The Thumbtack businesses the sign-in granted, one row per business.
--      webhook_token  random 48 hex characters; it is the last part of the
--                     address Thumbtack calls for this business, so it is
--                     what ties a lead to its business (and the only lock)
--      webhook_id     Thumbtack's id of the webhook created for it
--      subscribed     1 when the webhook exists and is enabled
--      last_error     why Thumbtack refused the last subscribe, if it did
--      last_lead_at   when the last lead from this business was created (UTC)
CREATE TABLE IF NOT EXISTS gm_thumbtack_businesses (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  business_id    TEXT NOT NULL,
  name           TEXT,
  webhook_token  TEXT NOT NULL,
  webhook_id     TEXT,
  subscribed     INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  last_lead_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, business_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_tt_biz_token ON gm_thumbtack_businesses (webhook_token);

-- 3. Every lead event Thumbtack sends, one row per negotiation id. The UNIQUE
--    key is what stops the same lead being created twice, so negotiation_id is
--    NOT NULL (in SQLite a NULL never collides with another NULL).
--      status      received | created | duplicate | failed
--      raw_event   the event as Thumbtack sent it (cleared after 90 days, and
--                  at once when the business disconnects)
--      lead_id     gm_leads.id once the lead exists
--      duplicates  how many more times Thumbtack sent the same event
CREATE TABLE IF NOT EXISTS gm_thumbtack_events (
  id              TEXT PRIMARY KEY,
  negotiation_id  TEXT NOT NULL UNIQUE,
  business_id     TEXT,
  client_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'received',
  error           TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  duplicates      INTEGER NOT NULL DEFAULT 0,
  raw_event       TEXT,
  lead_id         TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at      TEXT,
  processed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_tt_events_status ON gm_thumbtack_events (status, received_at);

-- 4. Single-use sign-in state: random, tied to one business and one login,
--    good for 15 minutes, used once.
CREATE TABLE IF NOT EXISTS gm_thumbtack_oauth_states (
  state        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  login_key    TEXT,
  actor_name   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);

-- 5. What a lead keeps from Thumbtack. All NULL on every lead that did not
--    come from Thumbtack.
--      thumbtack_negotiation_id  Thumbtack's id of the lead
--      thumbtack_category        the service category name
--      thumbtack_details_json    [{"q": "<question>", "a": "<answer>"}] plus
--                                the request description as the first row
--      thumbtack_lead_price      what Thumbtack charged for the lead, as sent
ALTER TABLE gm_leads ADD COLUMN thumbtack_negotiation_id TEXT;
ALTER TABLE gm_leads ADD COLUMN thumbtack_category TEXT;
ALTER TABLE gm_leads ADD COLUMN thumbtack_details_json TEXT;
ALTER TABLE gm_leads ADD COLUMN thumbtack_lead_price TEXT;
CREATE INDEX IF NOT EXISTS idx_gml_thumbtack_neg ON gm_leads (client_id, thumbtack_negotiation_id);
