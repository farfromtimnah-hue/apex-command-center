-- A bill can repeat every N months (the waste bill is quarterly). period_anchor_month is one month
-- the bill is due in (1-12); the others follow every period_months. Existing bills stay monthly.
ALTER TABLE fixed_bills ADD COLUMN period_months INTEGER DEFAULT 1;
ALTER TABLE fixed_bills ADD COLUMN period_anchor_month INTEGER;
-- Waste Connections invoices 01/04/07/10 (last seen invoice 07/20/26, due 07/25/26).
UPDATE fixed_bills SET period_months = 3, period_anchor_month = 7 WHERE id = 'fb_lixo';
