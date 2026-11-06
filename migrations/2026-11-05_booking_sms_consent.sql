-- Text consent on the customer booking page (book.html), 2026-11-05. ADDITIVE ONLY.
-- Stored on the booking record the page already creates (gm_booking_requests).
--   sms_consent_status  'agreed', 'declined' or NULL (NULL = every booking made
--                       before the checkbox existed; reminders keep working for NULL)
--   sms_consent_at      UTC ISO timestamp, set when the status is agreed or declined
-- The Worker validates the two values; the CHECK is a second wall.
ALTER TABLE gm_booking_requests ADD COLUMN sms_consent_status TEXT CHECK (sms_consent_status IS NULL OR sms_consent_status IN ('agreed', 'declined'));
ALTER TABLE gm_booking_requests ADD COLUMN sms_consent_at TEXT;
