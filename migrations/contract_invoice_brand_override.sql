-- The look a contract or invoice was sent with (2026-09-27, Nicole: "what I
-- approve and send stays that way"; item #14). Written on first send by
-- gmDocFreezeLook(); NULL = never sent (or sent before this), the page uses
-- the live settings. Read by gmEstApplyBrandOverride().
ALTER TABLE gm_contracts ADD COLUMN brand_override_json TEXT DEFAULT NULL;
ALTER TABLE gm_invoices ADD COLUMN brand_override_json TEXT DEFAULT NULL;
