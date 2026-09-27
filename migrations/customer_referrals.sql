-- Hero follow-up (2026-09-27), Part I: salesperson contact card + customer
-- referral link. Reuses gm_partners (referral_slug, parceiro_id attribution,
-- gm_referral_hits rate limit); no second referral system. Run ONCE.
-- I1: a customer referrer is a partner row linked to that customer's lead,
-- created the first time a card is sent, never twice (UNIQUE client+lead).
ALTER TABLE gm_partners ADD COLUMN lead_id TEXT DEFAULT NULL;
-- I4: the public card page token (unguessable; separate from the referral
-- slug, which is the link the customer shares with friends).
ALTER TABLE gm_partners ADD COLUMN card_token TEXT DEFAULT NULL;
-- I5: the salesperson a referral through this customer is assigned to.
ALTER TABLE gm_partners ADD COLUMN seller_name TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_partners_client_lead ON gm_partners (client_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_partners_card_token ON gm_partners (card_token) WHERE card_token IS NOT NULL;
-- I5: "Not <first name>" on the referral form: still a referral through the
-- same customer, flagged for the salesperson, who records the actual
-- referrer here (never the prospect).
ALTER TABLE gm_leads ADD COLUMN referrer_to_confirm INTEGER DEFAULT NULL;
ALTER TABLE gm_leads ADD COLUMN actual_referrer TEXT DEFAULT NULL;
-- I2: the salesperson's own contact details and photo (salespeople are names
-- in gm_config.vendedores_json; this is keyed the same way).
CREATE TABLE IF NOT EXISTS gm_seller_profiles (
    client_id    TEXT NOT NULL,
    seller_name  TEXT NOT NULL,
    phone        TEXT,
    email        TEXT,
    title        TEXT,
    photo_r2_key TEXT,
    updated_by   TEXT,
    updated_at   TEXT,
    PRIMARY KEY (client_id, seller_name)
);
