-- Business System partner links: the stage a partner's link creates its leads
-- at (2026-10-30). Additive, one nullable column. NULL means the stage Lead.
-- Only Business System partners use it; a Consulting partner keeps NULL.
-- The value is checked on the server against the Business System stage list.
ALTER TABLE apex_partners ADD COLUMN start_stage TEXT;
