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
  created_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_invites_person ON login_invites (person_id);

-- The passkey allow-list. A sign-in counts only when its registration id is
-- here and revoked_at is NULL. Revoking a lost phone is setting revoked_at.
CREATE TABLE IF NOT EXISTS login_passkeys (
  id                       TEXT PRIMARY KEY,
  person_id                TEXT NOT NULL,
  webauthn_registration_id TEXT NOT NULL UNIQUE,
  created_at               TEXT,
  revoked_at               TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_passkeys_person ON login_passkeys (person_id);

-- Every SMS code send, for the per-invite, app-wide and per-IP caps. Rows
-- older than 3 days are deleted on every insert.
CREATE TABLE IF NOT EXISTS login_code_sends (
  id         TEXT PRIMARY KEY,
  created_at TEXT,
  person_id  TEXT,
  ip         TEXT
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
