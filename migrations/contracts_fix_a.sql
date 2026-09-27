-- Contracts fix build, checkpoint A (F20): the render stored at homeowner
-- signing, with the real Eastern transaction date and cancellation deadline.
-- content_hash stays the company-signing snapshot hash; this is the second,
-- separate hash of the signed-time render. Additive only.
ALTER TABLE gm_contracts ADD COLUMN signed_render_r2_key TEXT;
ALTER TABLE gm_contracts ADD COLUMN signed_render_hash TEXT;
