-- Add pricing fields to the packages table
-- Run against the live D1 database: apex-db

ALTER TABLE packages ADD COLUMN base_price    REAL;
ALTER TABLE packages ADD COLUMN has_payment_plan INTEGER NOT NULL DEFAULT 0;
ALTER TABLE packages ADD COLUMN installment_count  INTEGER;
ALTER TABLE packages ADD COLUMN installment_amount REAL;
