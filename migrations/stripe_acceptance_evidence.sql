-- Stripe acceptance evidence (2026-10-04). APPEND-ONLY: no code path UPDATEs
-- or DELETEs a row. One row per agreement: who, when, from where, the exact
-- words shown, and which version of the Terms and Privacy Policy were live.
-- note: why a version or hash is NULL (the page could not be fetched). The
-- agreement is recorded either way; a connect is never blocked on this.
CREATE TABLE IF NOT EXISTS gm_stripe_acceptances (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_name TEXT,
  user_role TEXT,
  accepted_at TEXT NOT NULL,
  terms_version TEXT,
  privacy_version TEXT,
  terms_sha256 TEXT,
  privacy_sha256 TEXT,
  shown_language TEXT,
  shown_text TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  stripe_account_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_stripe_acceptances_client ON gm_stripe_acceptances (client_id, accepted_at);
