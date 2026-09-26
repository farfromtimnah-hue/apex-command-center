-- Client portal estimates & invoices — PHASE 1b: brand colors.
--
-- Nicole, 2026-09-26: the customer-facing pages and print templates carry
-- the CLIENT's brand, never Apex's. Two hex colors, pre-filled from
-- clients.referral_bg_color / referral_text_color when those are set; when
-- neither is set the documents fall back to a neutral dark gray + white.
ALTER TABLE gm_doc_settings ADD COLUMN brand_primary TEXT;   -- '#RRGGBB'
ALTER TABLE gm_doc_settings ADD COLUMN brand_accent  TEXT;   -- '#RRGGBB'
