-- client_login_attempts is the rate-limit ledger for the public
-- POST /api/auth/client-login endpoint. One row per attempt, valid or not,
-- so hammering invalid credentials cannot bypass the counter. Mirrors the
-- gm_referral_hits pattern already used for the public referral endpoints.
--
-- We key on both the submitted username and the client IP:
--   - per-username limit stops a brute-force run against one account
--   - per-IP limit stops one host spraying many usernames
-- Old rows are pruned opportunistically inside the handler.

CREATE TABLE IF NOT EXISTS client_login_attempts (
  id         TEXT PRIMARY KEY,
  username   TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cla_username ON client_login_attempts (username, created_at);
CREATE INDEX IF NOT EXISTS idx_cla_ip ON client_login_attempts (ip, created_at);
