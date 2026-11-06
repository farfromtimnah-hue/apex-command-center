-- A project's own address. Before this, a project had no address and its
-- weather location came only from its linked lead. Same column names and types
-- as gm_leads (migrations/2026-10-13_lead_geocode.sql). Plain ADD COLUMN: every
-- existing row gets NULL, so existing projects work exactly as before.
-- addr_located: exact | county | zip | town | manual (NULL when nothing was found).
ALTER TABLE gm_jobs ADD COLUMN addr_street TEXT;
ALTER TABLE gm_jobs ADD COLUMN addr_city TEXT;
ALTER TABLE gm_jobs ADD COLUMN addr_state TEXT;
ALTER TABLE gm_jobs ADD COLUMN addr_zip TEXT;
ALTER TABLE gm_jobs ADD COLUMN addr_lat REAL;
ALTER TABLE gm_jobs ADD COLUMN addr_lon REAL;
ALTER TABLE gm_jobs ADD COLUMN addr_located TEXT;
