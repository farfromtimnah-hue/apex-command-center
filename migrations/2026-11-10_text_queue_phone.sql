-- STOP drops every held notice for a phone, so the queue needs the phone.
-- (A held notice only has the recipient key and a JSON snapshot.) NULL for any older row.
ALTER TABLE reminder_text_queue ADD COLUMN phone_e164 TEXT;
CREATE INDEX IF NOT EXISTS idx_rtq_phone ON reminder_text_queue (phone_e164, status);
