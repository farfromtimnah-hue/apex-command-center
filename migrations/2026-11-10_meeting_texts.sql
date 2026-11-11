-- Text messages for meetings: confirmation, reminder, change, cancel.
-- One file. Safe to read twice: tables and indexes use IF NOT EXISTS, and the
-- rebuild of reminder_text_sends keeps every old row (they become kind 'reminder').
--
-- 1. reminder_text_sends gets a kind and the meeting's date and time at the
--    moment of sending. The old key UNIQUE (session_id, recipient) would block a
--    second KIND for the same meeting, and SQLite cannot drop a table
--    constraint, so the table is rebuilt with the new key
--    UNIQUE (session_id, recipient, kind, meeting_at). Old rows: kind
--    'reminder', meeting_at '' (the sender treats '' as "any time").
CREATE TABLE IF NOT EXISTS reminder_text_sends_v2 (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  phone_e164  TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  twilio_sid  TEXT,
  kind        TEXT NOT NULL DEFAULT 'reminder',
  meeting_at  TEXT NOT NULL DEFAULT '',
  UNIQUE (session_id, recipient, kind, meeting_at)
);
INSERT OR IGNORE INTO reminder_text_sends_v2 (id, session_id, recipient, phone_e164, sent_at, twilio_sid, kind, meeting_at)
  SELECT id, session_id, recipient, phone_e164, sent_at, twilio_sid, 'reminder', '' FROM reminder_text_sends;
DROP TABLE reminder_text_sends;
ALTER TABLE reminder_text_sends_v2 RENAME TO reminder_text_sends;
CREATE INDEX IF NOT EXISTS idx_rts_phone ON reminder_text_sends (phone_e164, sent_at);

-- 2. Notices that came due between 9:00 PM and 8:00 AM local, held until the
--    first 5-minute tick at or after 8:00 AM. payload is the meeting's facts as
--    JSON (a cancel notice cannot read a meeting that is gone). The partial
--    unique index lets the database refuse a second held copy of the same notice.
CREATE TABLE IF NOT EXISTS reminder_text_queue (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  meeting_ref TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  send_after  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  payload     TEXT
);
CREATE INDEX IF NOT EXISTS idx_rtq_due ON reminder_text_queue (status, send_after);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rtq_pending ON reminder_text_queue (kind, meeting_ref, recipient) WHERE status = 'pending';

-- 3. What customers answer. message_sid is Twilio's id for the message, so a
--    retried webhook is stored once. One confirmation per meeting and phone.
CREATE TABLE IF NOT EXISTS reminder_text_replies (
  id          TEXT PRIMARY KEY,
  phone_e164  TEXT NOT NULL,
  session_ref TEXT,
  kind        TEXT NOT NULL,
  body        TEXT,
  received_at TEXT NOT NULL,
  forwarded   INTEGER NOT NULL DEFAULT 0,
  message_sid TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rtr_sid ON reminder_text_replies (message_sid) WHERE message_sid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rtr_confirm ON reminder_text_replies (session_ref, phone_e164) WHERE kind = 'confirm';

-- 4. The host's phone for a text ("To reach Rafa, tap +1 555-555-5555").
--    No staff phone was stored anywhere. Empty until someone fills it in. No
--    text is sent for a host with no phone (counted as no_callback_phone).
--    Last on purpose: a second run stops here and nothing above is repeated.
ALTER TABLE users ADD COLUMN phone TEXT;
