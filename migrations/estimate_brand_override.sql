-- The look an estimate was sent with (2026-09-27, Nicole: "what I approve and
-- send stays that way"). Written on first send; NULL = never sent yet, the page
-- uses the live settings. Read by gmEstApplyBrandOverride().
ALTER TABLE gm_estimates ADD COLUMN brand_override_json TEXT DEFAULT NULL;
