-- Task 2.10: change orders freeze their look the same way invoices and
-- contracts already do (gmDocFreezeLook), so an issued one keeps the look
-- it had when issued even if the business later changes its logo or brand
-- colors. Additive only.
ALTER TABLE gm_change_orders ADD COLUMN brand_override_json TEXT DEFAULT NULL;
