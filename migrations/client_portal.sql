-- Client Portal build (2026-07-13): daily-entry log, per-client field config,
-- missed-day tracking, client login credentials, and the new 'client' role.
-- Fully additive — no existing table's columns are modified or removed.

-- Link a users row (Google sign-in) to a client account. NULL for all
-- existing alice/rafa/developer rows — their auth flow is untouched.
ALTER TABLE users ADD COLUMN client_id TEXT;

-- One row per client per day. sections_json holds every indicator value,
-- grouped by section, each section stamped when submitted:
--   { "financeiro":       { "values": {"receita": 1200, ...}, "submitted_at": "ISO" },
--     "clientes_mercado": { ... }, "processos": { ... },
--     "crescimento":      { ... }, "rotina": { "values": {"rotina_completa": 1}, ... } }
-- Draft (autosaved, not yet submitted) sections carry "draft_values" instead of
-- a submitted_at stamp. completed=1 only when every applicable section has
-- submitted_at — only then does the day count toward monthly totals.
-- lucro_liquido / margem_lucro are recomputed server-side from receita/saida
-- on every write; client-sent values for them are ignored.
CREATE TABLE IF NOT EXISTS client_daily_entries (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  entry_date    TEXT NOT NULL,              -- 'YYYY-MM-DD'
  sections_json TEXT NOT NULL DEFAULT '{}',
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_cde_client_date
  ON client_daily_entries (client_id, entry_date);

-- Which indicators apply to a given client + their monthly target.
-- No row for an indicator = default (enabled, no target).
CREATE TABLE IF NOT EXISTS client_field_config (
  client_id     TEXT NOT NULL,
  indicator_key TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  meta_mensal   REAL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, indicator_key)
);

-- Missed-day tracking: 'day_off' (holiday / folga, chosen by the client with
-- an optional reason shown on the admin profile) or 'filled_late' (backlogged
-- day completed after the fact).
CREATE TABLE IF NOT EXISTS client_missed_days (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  missed_date TEXT NOT NULL,                -- 'YYYY-MM-DD'
  status      TEXT NOT NULL DEFAULT 'day_off',  -- 'day_off' | 'filled_late'
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, missed_date)
);

-- Username/password credentials for the client role. One login per client.
-- password_hash format: pbkdf2$<iterations>$<salt_b64>$<hash_b64> (SHA-256).
-- tracking_start: first date the daily-entry backlog is counted from.
CREATE TABLE IF NOT EXISTS client_logins (
  username             TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  tracking_start       TEXT,
  password_changed_at  TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Opaque bearer tokens for password-based client sessions (Google client
-- sign-ins keep using Firebase tokens). Only the SHA-256 of the token is
-- stored. Tokens expire; expired rows are lazily purged on login.
CREATE TABLE IF NOT EXISTS client_auth_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  username   TEXT NOT NULL,
  expires_at TEXT NOT NULL,                 -- ISO datetime
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cat_client ON client_auth_tokens (client_id);
