-- Migration: add zoho_customer_id to clients table
-- Applied directly to the live D1 database (not via wrangler migration runner).
-- The column was added and backfilled in the live "Apex Business & Leadership" org (org_id 929994947).
--
-- Command run against production D1:
--   ALTER TABLE clients ADD COLUMN zoho_customer_id TEXT;
--
-- Backfill applied:
--   UPDATE clients SET zoho_customer_id = '455783000000098001'
--     WHERE id = 'c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c';  -- Elevate
--   UPDATE clients SET zoho_customer_id = '455783000000100001'
--     WHERE id = 'b4dff5c5-cbcc-4609-aa93-0d82e8db6044';  -- METZ

-- Reproduce from scratch:
ALTER TABLE clients ADD COLUMN zoho_customer_id TEXT;
