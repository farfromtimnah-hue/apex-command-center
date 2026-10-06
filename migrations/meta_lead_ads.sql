-- Job 38: Facebook and Instagram lead ads.
--
-- A business connects its Facebook Page in the portal (Estimates > Settings),
-- and every lead from its lead ads lands in its pipeline by itself.
--
-- ADD-ONLY. Nothing existing is changed or deleted.
--
-- ORDER: deploy the Worker FIRST or AFTER, either is safe. Without these
-- tables the Worker reads the feature as "not available yet", the owner routes
-- answer with that message, and the webhook answers 503 (so Meta sends the
-- lead again later, for up to 36 hours). Nothing else in the Worker reads
-- these tables. Run this file BEFORE the app is given its webhook address in
-- Meta's dashboard, so no lead ever waits on a retry.
--
-- Run each statement once. An ALTER fails with "duplicate column name" if it
-- is run a second time; that error is harmless.

-- 1. One connection per business. The token is SEALED (tokenSeal, "enc:v1:")
--    and never leaves the Worker.
--      meta_business_id   the Meta business that connected (client_business_id)
--      meta_user_id       the Meta user who signed in; Meta's data deletion
--                         request is matched on it
--      connected_by       the display name of the portal login that connected
--      connected_login    that login (username or email)
--      needs_reconnect    1 when Meta refused the token while reading a lead
--      reconnect_pushed_at  set when the owner was told, so they are told once
CREATE TABLE IF NOT EXISTS gm_meta_connections (
  client_id            TEXT PRIMARY KEY,
  token_sealed         TEXT NOT NULL,
  meta_business_id     TEXT,
  meta_user_id         TEXT,
  connected_by         TEXT,
  connected_login      TEXT,
  connected_at         TEXT NOT NULL DEFAULT (datetime('now')),
  needs_reconnect      INTEGER NOT NULL DEFAULT 0,
  reconnect_pushed_at  TEXT,
  last_error           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_meta_conn_user ON gm_meta_connections (meta_user_id);

-- 2. The Pages Meta granted, one row per business and Page. The Page token is
--    SEALED too.
--      subscribed     1 when the Page sends its lead events to Apex
--      last_error     why Meta refused the last subscribe, if it did
--      last_lead_at   when the last lead from this Page was created (UTC)
CREATE TABLE IF NOT EXISTS gm_meta_pages (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  page_id       TEXT NOT NULL,
  page_name     TEXT,
  token_sealed  TEXT NOT NULL,
  subscribed    INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  last_lead_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_meta_pages_page ON gm_meta_pages (page_id, subscribed);

-- 3. Every lead event Meta sends, one row per leadgen_id. The UNIQUE key is
--    what stops the same lead being created twice, so leadgen_id is NOT NULL
--    (in SQLite a NULL never collides with another NULL).
--      status      received | processing | created | unmatched | failed |
--                  needs_reconnect
--      error       why the lead could not be read (never a token)
--      raw_event   the event as Meta sent it        } cleared after 90 days
--      raw_lead    Meta's answer when the lead was read }
--      lead_id     gm_leads.id once the lead exists
--      duplicates  how many more times Meta sent the same event
CREATE TABLE IF NOT EXISTS gm_meta_events (
  id                 TEXT PRIMARY KEY,
  leadgen_id         TEXT NOT NULL UNIQUE,
  page_id            TEXT,
  client_id          TEXT,
  form_id            TEXT,
  ad_id              TEXT,
  status             TEXT NOT NULL DEFAULT 'received',
  error              TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  duplicates         INTEGER NOT NULL DEFAULT 0,
  raw_event          TEXT,
  raw_lead           TEXT,
  lead_id            TEXT,
  event_created_time TEXT,
  received_at        TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at         TEXT,
  processed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_meta_events_status ON gm_meta_events (status, received_at);
CREATE INDEX IF NOT EXISTS idx_gm_meta_events_page ON gm_meta_events (page_id, status);

-- 4. Single-use sign-in state: random, tied to one business and one login,
--    good for 15 minutes, used once.
CREATE TABLE IF NOT EXISTS gm_meta_oauth_states (
  state        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  login_key    TEXT,
  actor_name   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);

-- 5. Meta's data deletion requests: the confirmation code and the day, for the
--    public status page. It keeps no Meta user id.
CREATE TABLE IF NOT EXISTS gm_meta_deletions (
  code                 TEXT PRIMARY KEY,
  connections_removed  INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. What a lead keeps from the ad. All NULL on every lead that did not come
--    from a lead ad.
--      meta_platform       'fb' or 'ig', as Meta sends it
--      meta_answers_json   [{"q": "<question>", "a": "<answer>"}] for every
--                          answer on the form that is not the name, phone,
--                          email, street or city
ALTER TABLE gm_leads ADD COLUMN meta_leadgen_id TEXT;
ALTER TABLE gm_leads ADD COLUMN meta_platform TEXT;
ALTER TABLE gm_leads ADD COLUMN meta_campaign_name TEXT;
ALTER TABLE gm_leads ADD COLUMN meta_ad_name TEXT;
ALTER TABLE gm_leads ADD COLUMN meta_form_id TEXT;
ALTER TABLE gm_leads ADD COLUMN meta_answers_json TEXT;
CREATE INDEX IF NOT EXISTS idx_gml_meta_leadgen ON gm_leads (client_id, meta_leadgen_id);
