-- Add list-price fields for the new APEX START/ADVANCED/GROWTH packages.
-- Legacy packages (Raio-X, Sprint, Premium, Executivo) keep using base_price
-- and leave these new columns null.
-- Run against the live D1 database: apex-command-center

ALTER TABLE packages ADD COLUMN upfront_price REAL;
ALTER TABLE packages ADD COLUMN installment_total_price REAL;
ALTER TABLE packages ADD COLUMN default_installment_count INTEGER;
ALTER TABLE packages ADD COLUMN default_installment_amount REAL;
