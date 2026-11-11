-- Replies must never be missed: who the reply belongs to, so the list can be
-- scoped (a client owner sees only their own), and indexes so the 5-minute
-- tick finds unforwarded replies with one indexed read.
-- Run once. A second run stops at the first ALTER, before anything changes.
ALTER TABLE reminder_text_replies ADD COLUMN client_id TEXT;
ALTER TABLE reminder_text_replies ADD COLUMN person_name TEXT;
ALTER TABLE reminder_text_replies ADD COLUMN meeting_at TEXT;
CREATE INDEX IF NOT EXISTS idx_rtr_retry ON reminder_text_replies (forwarded, received_at);
CREATE INDEX IF NOT EXISTS idx_rtr_client ON reminder_text_replies (client_id, received_at);
