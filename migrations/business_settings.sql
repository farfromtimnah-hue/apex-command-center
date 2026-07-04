-- Migration: create business_settings table (single-row global config)
-- Applied directly to the live D1 database.
--
-- Commands run against production D1:
--   CREATE TABLE IF NOT EXISTS business_settings (
--     id               INTEGER PRIMARY KEY DEFAULT 1,
--     zelle_qr_r2_key  TEXT,
--     stripe_payment_link TEXT,
--     updated_at       TEXT
--   );
--   INSERT OR IGNORE INTO business_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS business_settings (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    zelle_qr_r2_key     TEXT,
    stripe_payment_link TEXT,
    updated_at          TEXT
);

INSERT OR IGNORE INTO business_settings (id) VALUES (1);
