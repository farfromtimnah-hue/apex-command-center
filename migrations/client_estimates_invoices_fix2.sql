-- Client portal estimates & invoices — FIX BUILD 2 (C1, Nicole's decision):
-- the discount is PER OPTION. In tiered mode Best / Better / Good each carry
-- their own discount type and value. Additive; gm_estimates.discount_type /
-- discount_value stay as the fallback for rows written before this.
ALTER TABLE gm_estimate_options ADD COLUMN discount_type TEXT;   -- amount | pct | NULL
ALTER TABLE gm_estimate_options ADD COLUMN discount_value REAL;  -- cents for amount, percent for pct
