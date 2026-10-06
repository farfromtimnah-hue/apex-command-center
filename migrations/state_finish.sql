-- RES-36: the subcontractor and supplier list some states ask for
-- (Texas Prop. Code 53.256, Idaho 45-525, Nevada NRS 624.600).
--
-- ADDS ONLY. Nothing existing is changed or removed.
--   1. gm_subcontractors gets an address and a telephone (the list needs both).
--   2. gm_job_suppliers: the suppliers of one project (name, address,
--      telephone, what they supply).
--
-- ORDER: run this BEFORE the Worker deploy. The Worker reads both with a
-- fallback (an empty list, no address), so nothing breaks if the deploy goes
-- first, but saving an address, a telephone or a supplier answers "not
-- available yet" until this has run.
--
-- The two ALTER statements fail with "duplicate column name" if this file is
-- run twice; that is harmless (the column is already there). Run each
-- statement once.

ALTER TABLE gm_subcontractors ADD COLUMN address TEXT;
ALTER TABLE gm_subcontractors ADD COLUMN phone TEXT;

CREATE TABLE IF NOT EXISTS gm_job_suppliers (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  supplies    TEXT,                -- what they supply (free text)
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_job_suppliers_job ON gm_job_suppliers (client_id, job_id);
