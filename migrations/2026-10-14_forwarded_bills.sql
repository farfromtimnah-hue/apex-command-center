-- Forwarded bills (water and waste) read themselves into the bills.
-- See the build prompt: Alice forwards fb_agua / fb_lixo bill emails to
-- support@resonateai.online (a Resonate Zoho Mail alias). Apex reads that
-- mailbox, extracts the real amount/due date with Claude, and reminds Alice.

-- 1. Logged inbound mail (never the body -- status, subject, sender, note only).
CREATE TABLE IF NOT EXISTS bill_emails (
  id           TEXT PRIMARY KEY,
  message_id   TEXT UNIQUE,
  received_at  TEXT,
  from_address TEXT,
  subject      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('parsed','unmatched','ignored','rejected','error')),
  bill_id      TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. The real amount/due date read off a bill email, one row per bill+month.
CREATE TABLE IF NOT EXISTS fixed_bill_statements (
  id                TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL,
  period_key        TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  due_date          TEXT NOT NULL,
  pay_url           TEXT,
  message_id        TEXT,
  differs_from_last INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bill_id, period_key)
);

-- 3. One row per reminder actually sent, so nothing repeats on the next cron tick.
CREATE TABLE IF NOT EXISTS bill_reminders_sent (
  bill_id    TEXT NOT NULL,
  period_key TEXT NOT NULL,
  kind       TEXT NOT NULL,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bill_id, period_key, kind)
);

-- 4. The Zoho Mail OAuth connection will be stored the same way as the
-- existing Zoho Books / Google rows in oauth_tokens, under its own id
-- ('zoho_mail') written by the connect callback on first connect -- never
-- pre-seeded here, so the Books/Google rows are untouched either way.
-- Last successful mailbox read (first run looks back 45 days instead).
ALTER TABLE oauth_tokens ADD COLUMN last_read_at TEXT;

-- 5. oauth_state has no "which flow" column (it has only ever served Zoho
-- Books). The Mail connect button reuses the same registered redirect_uri
-- and callback route, so the callback must tell the two apart; it does that
-- by reading this column, defaulting to 'zoho_books' for any in-flight row
-- from before this migration.
ALTER TABLE oauth_state ADD COLUMN flow TEXT NOT NULL DEFAULT 'zoho_books';

