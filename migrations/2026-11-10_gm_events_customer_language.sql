-- The language the customer used on the booking page (en, pt or es), saved with the
-- meeting so every text goes out in the customer's language, not the client's.
-- NULL means unknown: texts then go in English.
ALTER TABLE gm_events ADD COLUMN customer_language TEXT DEFAULT NULL;
