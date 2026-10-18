-- Passkey login (Stytch SMS code + WebAuthn), 2026-10-18. ADDITIVE ONLY.
--
-- Apex keeps its own people, roles, sessions and permissions here. Stytch is
-- used only for (a) a one-time SMS code to the number stored below and
-- (b) passkey registration and authentication. Sessions are the existing
-- client_auth_tokens rows, minted against a client_logins row exactly like the
-- username/password login, so every existing session, gate and kill switch
-- keeps working.
--
-- New client_logins.role values introduced by this build (no schema change,
-- the column is free text): 'partner', 'staff_finance', 'staff'. A person
-- created by an invite gets a client_logins row with username 'pk-<random>'
-- and password_hash 'PASSKEY_ONLY', which the password check always refuses.
--
-- DEPLOY ORDER: apply this file to D1 BEFORE deploying the Worker that reads
-- these tables. Nothing reads them while PASSKEY_LOGIN_ENABLED is not "1".
--
-- 2026-10-18 (login completion): edited IN PLACE (never applied anywhere yet)
-- to add every column and table the completion spec needs -- invite
-- purposes, passkey labels, WhatsApp, device-loss events, legacy cutover,
-- the security audit log, the loss review, the session/country anomaly
-- check, seats and a business source tag. See CHANGE markers below.

-- One row per person who may sign in with a passkey at one business.
-- role: 'client' (the owner), 'partner', 'staff_finance', 'staff', 'seller'.
-- status: 'invited' until the first passkey is registered, then 'active';
-- 'disabled' blocks sign-in and code sends.
CREATE TABLE IF NOT EXISTS login_people (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  role                  TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  phone_e164            TEXT NOT NULL,
  username              TEXT,
  stytch_user_id        TEXT,
  status                TEXT NOT NULL DEFAULT 'invited',
  created_by            TEXT,
  created_at            TEXT,
  accepted_at           TEXT,
  last_passkey_login_at TEXT,
  UNIQUE (client_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS idx_login_people_client ON login_people (client_id);
CREATE INDEX IF NOT EXISTS idx_login_people_stytch ON login_people (stytch_user_id);

-- One row per invite link. Only the SHA-256 of the link token is stored.
-- CHANGE A: purpose -- 'first' (a person's first ever invite), 'add' (add
-- another device, keep every current passkey) or 'replace' (new or lost
-- device: every current passkey of the person is revoked once THIS invite
-- completes).
CREATE TABLE IF NOT EXISTS login_invites (
  id                   TEXT PRIMARY KEY,
  person_id            TEXT NOT NULL,
  token_hash           TEXT NOT NULL UNIQUE,
  expires_at           TEXT NOT NULL,
  used_at              TEXT,
  replaced_at          TEXT,
  code_sends           INTEGER NOT NULL DEFAULT 0,
  code_verify_failures INTEGER NOT NULL DEFAULT 0,
  last_send_at         TEXT,
  stytch_method_id     TEXT,
  register_until       TEXT,
  created_at           TEXT,
  purpose              TEXT NOT NULL DEFAULT 'first'
);
CREATE INDEX IF NOT EXISTS idx_login_invites_person ON login_invites (person_id);

-- The passkey allow-list. A sign-in counts only when its registration id is
-- here and revoked_at is NULL. Revoking a lost phone is setting revoked_at.
-- CHANGE A: label / user_agent -- a short device name ("iPhone Safari") and
-- the first 200 characters of the User-Agent, captured at registration time.
CREATE TABLE IF NOT EXISTS login_passkeys (
  id                       TEXT PRIMARY KEY,
  person_id                TEXT NOT NULL,
  webauthn_registration_id TEXT NOT NULL UNIQUE,
  created_at               TEXT,
  revoked_at               TEXT,
  label                    TEXT,
  user_agent               TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_passkeys_person ON login_passkeys (person_id);

-- Every code send (SMS or WhatsApp), for the per-invite, app-wide and per-IP
-- caps. Rows older than 3 days are deleted on every insert. CHANGE E: channel
-- ('sms' or 'whatsapp') lets the two app-wide daily caps be counted
-- separately; existing rows with no channel count as 'sms'.
CREATE TABLE IF NOT EXISTS login_code_sends (
  id         TEXT PRIMARY KEY,
  created_at TEXT,
  person_id  TEXT,
  ip         TEXT,
  channel    TEXT NOT NULL DEFAULT 'sms'
);
CREATE INDEX IF NOT EXISTS idx_login_code_sends_created ON login_code_sends (created_at);
CREATE INDEX IF NOT EXISTS idx_login_code_sends_ip ON login_code_sends (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_login_code_sends_person ON login_code_sends (person_id, created_at);

-- Rate limit for the public passkey sign-in (start + finish), per IP, in the
-- style of client_login_attempts. Rows older than 2 days are pruned.
CREATE TABLE IF NOT EXISTS passkey_login_attempts (
  id         TEXT PRIMARY KEY,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pla_ip ON passkey_login_attempts (ip, created_at);

-- The SMS volume alert to Nicole fires once per UTC day per threshold
-- ('half' and 'cap'); this row is the "already sent today" marker.
CREATE TABLE IF NOT EXISTS passkey_sms_alerts (
  day       TEXT NOT NULL,
  threshold TEXT NOT NULL,
  sent_at   TEXT,
  PRIMARY KEY (day, threshold)
);

-- CHANGE E: the same "already sent today" marker as passkey_sms_alerts, for
-- the SEPARATE app-wide WhatsApp daily cap (own message text).
CREATE TABLE IF NOT EXISTS passkey_whatsapp_alerts (
  day       TEXT NOT NULL,
  threshold TEXT NOT NULL,
  sent_at   TEXT,
  PRIMARY KEY (day, threshold)
);

-- ===========================================================================
-- Login completion build, 2026-10-18. ADDITIVE ONLY. Closes every gap decided
-- by the product owner: the three-reason device-loss flow (C), retiring the
-- old login one business at a time (F), the security audit log (G), the
-- lost-device review (H), the session/country anomaly check (I), seat
-- counting and policy (J) and a business source tag (K). Nothing reads any
-- of this while PASSKEY_LOGIN_ENABLED is not "1".
-- ===========================================================================

-- CHANGE C: one row per device-loss report (left / new_phone / lost).
-- reported_loss_at is ONLY for 'lost': WHEN THE DEVICE WENT MISSING (may be
-- days before created_at). created_at is WHEN IT WAS REPORTED (button press).
CREATE TABLE IF NOT EXISTS login_device_events (
  id               TEXT PRIMARY KEY,
  person_id        TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  reason           TEXT NOT NULL,
  reported_loss_at TEXT,
  when_choice      TEXT,
  reported_by      TEXT,
  created_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_device_events_person ON login_device_events (person_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_device_events_client ON login_device_events (client_id, created_at);

-- CHANGE F: one row per business whose old username/password login has been
-- turned off (the new passkey login fully covers it). Passkey sign-in is
-- never affected by this table.
CREATE TABLE IF NOT EXISTS login_legacy_cutover (
  client_id   TEXT PRIMARY KEY,
  disabled_at TEXT NOT NULL,
  disabled_by TEXT
);

-- CHANGE G: the security audit log. detail is a short JSON (<=500 chars) of
-- NON-PERSONAL fields only: path group, method, device label, ids, trusted
-- true/false for countries. NEVER field values, names, free text or anything
-- personal. country comes from the CF-IPCountry request header; ip_prefix is
-- the first three IPv4 octets or first four IPv6 groups, never the full
-- address.
CREATE TABLE IF NOT EXISTS login_activity (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  client_id    TEXT,
  person_id    TEXT,
  username     TEXT,
  role         TEXT,
  kind         TEXT NOT NULL,
  detail       TEXT,
  country      TEXT,
  ip_prefix    TEXT,
  device_label TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_activity_client ON login_activity (client_id, at);
CREATE INDEX IF NOT EXISTS idx_login_activity_person ON login_activity (person_id, at);
CREATE INDEX IF NOT EXISTS idx_login_activity_username ON login_activity (username, at);
CREATE INDEX IF NOT EXISTS idx_login_activity_at ON login_activity (at);

-- One-row-per-key marker table so a maintenance job (the 120-day
-- login_activity purge) runs at most once per day. Reusable by any future
-- daily job under a new key.
CREATE TABLE IF NOT EXISTS login_maintenance (
  key      TEXT PRIMARY KEY,
  last_run TEXT
);

-- CHANGE H: the lost-device review, built from login_activity between the
-- time the device went missing and the time it was reported, and from the
-- report time to now. reported_loss_at = when it went missing; reported_at =
-- when it was reported; created_at = when this review row was made.
CREATE TABLE IF NOT EXISTS login_loss_reviews (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL,
  person_id        TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  reported_loss_at TEXT NOT NULL,
  reported_at      TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',
  flagged          INTEGER NOT NULL DEFAULT 0,
  summary          TEXT,
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_loss_reviews_person ON login_loss_reviews (person_id);
CREATE INDEX IF NOT EXISTS idx_login_loss_reviews_client ON login_loss_reviews (client_id);
CREATE INDEX IF NOT EXISTS idx_login_loss_reviews_status ON login_loss_reviews (status);

-- CHANGE I: session/location anomaly check. US, BR and CA are trusted by
-- default (env.PASSKEY_TRUSTED_COUNTRIES). Sessions minted by the OLD
-- username/password login are never bound here.
CREATE TABLE IF NOT EXISTS login_session_meta (
  token_hash TEXT PRIMARY KEY,
  person_id  TEXT,
  country    TEXT NOT NULL,
  minted_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_known_places (
  person_id  TEXT NOT NULL,
  country    TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (person_id, country)
);

-- CHANGE J: seats. Seats used = login_people rows with status 'invited' or
-- 'active' for the business. mode: 'track' (never blocks or warns -- the
-- consulting / Apex-direct default), 'notice' (never blocks, shows a plain
-- note past included_seats -- the public_signup default), 'block' (refuses
-- at hard_limit, only ever set by an admin, for a business with a paid seat
-- count).
CREATE TABLE IF NOT EXISTS login_seat_policy (
  client_id      TEXT PRIMARY KEY,
  included_seats INTEGER NOT NULL DEFAULT 5,
  mode           TEXT NOT NULL DEFAULT 'track',
  hard_limit     INTEGER,
  set_by         TEXT,
  set_at         TEXT
);
CREATE TABLE IF NOT EXISTS login_seat_usage (
  client_id TEXT NOT NULL,
  day       TEXT NOT NULL,
  peak      INTEGER NOT NULL,
  PRIMARY KEY (client_id, day)
);

-- CHANGE K: business source tag. Drives only the default seat mode above
-- ('public_signup' -> 'notice' default; anything else, including no row,
-- -> 'track'). A business with no row counts as 'apex_direct'.
CREATE TABLE IF NOT EXISTS login_business_meta (
  client_id  TEXT PRIMARY KEY,
  source     TEXT NOT NULL DEFAULT 'apex_direct',
  updated_at TEXT
);
