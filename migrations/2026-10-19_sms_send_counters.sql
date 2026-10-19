-- Group 1.3: monthly SMS/WhatsApp caps (on top of the existing daily cap),
-- plus the two NEW reminder-text counters (task 1.5). Additive only.
--
-- ONE small table, not a COUNT(*) scan: every increment is a single
-- INSERT ... ON CONFLICT DO UPDATE SET count = count + 1, so two concurrent
-- sends can never race into an under-count, and the table never grows past
-- one row per (bucket, period_key) pair. bucket distinguishes the FOUR
-- counters this build needs: 'passkey_sms', 'passkey_whatsapp',
-- 'reminder_sms', 'reminder_whatsapp' (WhatsApp reminders are not built yet,
-- but the bucket name is reserved so a later build does not collide).
-- period_key is Eastern-calendar: 'YYYY-MM-DD' for a daily row, 'YYYY-MM'
-- for a monthly row (same bucket, two rows -- one of each key shape).
CREATE TABLE IF NOT EXISTS send_counters (
  bucket     TEXT NOT NULL,
  period_key TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (bucket, period_key)
);

-- The "already alerted this threshold" marker for the four NEW monthly caps
-- (passkey SMS, passkey WhatsApp, reminder SMS, reminder WhatsApp), same
-- shape as the existing passkey_sms_alerts/passkey_whatsapp_alerts (which
-- stay exactly as they are for the DAILY cap). period_key is 'YYYY-MM'.
CREATE TABLE IF NOT EXISTS send_counter_alerts (
  bucket     TEXT NOT NULL,
  period_key TEXT NOT NULL,
  threshold  TEXT NOT NULL,
  sent_at    TEXT,
  PRIMARY KEY (bucket, period_key, threshold)
);

-- Task 1.5: one row per meeting + recipient, written only after Twilio
-- accepted the message. The unique key is what makes "never send twice"
-- possible even if the 5-minute cron overlaps itself.
CREATE TABLE IF NOT EXISTS reminder_text_sends (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  phone_e164  TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  twilio_sid  TEXT,
  UNIQUE (session_id, recipient)
);

-- Task 1.5: a phone number Twilio refused for opting out (21610). Checked
-- before every send; never retried.
CREATE TABLE IF NOT EXISTS reminder_text_optouts (
  phone_e164 TEXT PRIMARY KEY,
  opted_out_at TEXT NOT NULL
);
