-- ABC Supply connection (Partner API, 2026-11-04).
--
-- A roofing contractor links their OWN ABC Supply account in the portal
-- (Estimates > Settings). Apex can then read that contractor's own account
-- prices and send material orders to ABC for them. Modelled on
-- migrations/thumbtack_connect.sql.
--
-- ABC's API terms shape every table here: one token set per contractor
-- connection (never pooled or shared), and NO price is stored anywhere. Prices
-- are asked from ABC on the spot and shown only to the contractor whose
-- account returned them.
--
-- ADD-ONLY. Nothing existing is changed or deleted.
--
-- ORDER: deploy the Worker FIRST or AFTER, either is safe. Without these
-- tables the Worker reads the feature as "not available yet", the owner routes
-- answer with that message, and the webhook answers 503.
--
-- Run each statement once.

-- 1. One connection per business. Both tokens are SEALED (tokenSeal,
--    "enc:v1:") and never leave the Worker.
--      ship_to_number / branch_number  the ABC account and branch the owner chose
--      environment                     the ABC environment the tokens belong to;
--                                      a token is never sent to the other one
--      needs_reconnect                 1 when ABC refused the token and a refresh failed
CREATE TABLE IF NOT EXISTS gm_abc_connections (
  client_id         TEXT PRIMARY KEY,
  token_sealed      TEXT NOT NULL,
  refresh_sealed    TEXT,
  token_expires_at  TEXT,
  connected_by      TEXT,
  connected_login   TEXT,
  connected_at      TEXT NOT NULL DEFAULT (datetime('now')),
  needs_reconnect   INTEGER NOT NULL DEFAULT 0,
  last_error        TEXT,
  ship_to_number    TEXT,
  branch_number     TEXT,
  environment       TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Single-use sign-in state: random, tied to one business and one login,
--    good for 15 minutes, used once. The PKCE verifier waits here SEALED.
CREATE TABLE IF NOT EXISTS gm_abc_oauth_states (
  state           TEXT PRIMARY KEY,
  verifier_sealed TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  login_key       TEXT,
  actor_name      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  used_at         TEXT
);

-- 3. The order webhook registered at ABC for one business (ABC allows five
--    per application, so it is ONE webhook carrying both events).
--      token_hash   SHA-256 of the random token in the address ABC calls; the
--                   token itself is never stored
--      secret_hash  SHA-256 of the secret ABC returned at registration; ABC
--                   sends that secret back with every event
--      abc_webhook_id  ABC's id of the webhook (needed to unregister it)
--    A row with an empty secret_hash is a claim made while registering: the
--    receiver ignores it.
CREATE TABLE IF NOT EXISTS gm_abc_webhooks (
  client_id       TEXT PRIMARY KEY,
  abc_webhook_id  TEXT,
  token_hash      TEXT NOT NULL UNIQUE,
  secret_hash     TEXT NOT NULL DEFAULT '',
  event_type      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Every material order Apex sent to ABC for a business.
--      order_ref     our reference (also sent to ABC as requestId and purchaseOrder)
--      abc_order_id  ABC's confirmation number
--      status        submitted (ABC staff have not accepted it yet), then
--                    whatever ABC's order events say; invoiced is final
CREATE TABLE IF NOT EXISTS gm_abc_orders (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  order_ref      TEXT NOT NULL,
  abc_order_id   TEXT,
  status         TEXT NOT NULL DEFAULT 'submitted',
  created_by     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_event_at  TEXT,
  UNIQUE (client_id, order_ref)
);
CREATE INDEX IF NOT EXISTS idx_gm_abc_orders_abc ON gm_abc_orders (client_id, abc_order_id);
