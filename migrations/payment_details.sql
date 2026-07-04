-- Migration: add zelle_qr_r2_key and stripe_payment_link to clients table
-- Applied directly to the live D1 database.
--
-- Commands run against production D1:
--   ALTER TABLE clients ADD COLUMN zelle_qr_r2_key TEXT;
--   ALTER TABLE clients ADD COLUMN stripe_payment_link TEXT;
--
-- zelle_qr_r2_key: R2 object key for the uploaded Zelle QR code image (e.g. "qr-codes/<id>.png")
-- stripe_payment_link: plain URL to the client's Stripe payment link

-- Reproduce from scratch:
ALTER TABLE clients ADD COLUMN zelle_qr_r2_key TEXT;
ALTER TABLE clients ADD COLUMN stripe_payment_link TEXT;
