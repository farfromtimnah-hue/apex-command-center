-- Task 5.2: "Meu próprio contrato" -- the business uploads their own PDF
-- contract, Claude maps it onto the Apex standard template's clause areas,
-- a developer or partner marks it reviewed before it can be used. One row
-- per upload attempt (a retry after a malformed-output failure is its own
-- row, never overwritten); status: pending_review | reviewed.
CREATE TABLE IF NOT EXISTS gm_contract_own_templates (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  r2_key          TEXT NOT NULL,
  original_name   TEXT,
  page_count      INTEGER,
  mapping_json    TEXT,              -- { areas: [{key,name,excerpt|null}], unmatched: [...] }
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_review',
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  uploaded_by     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_contract_own_templates_client ON gm_contract_own_templates (client_id, created_at);

-- Task 5.2: 5 uploads per business per day, atomic increment (WHERE guard,
-- same pattern as every other counter in this build).
CREATE TABLE IF NOT EXISTS gm_contract_own_template_counters (
  client_id   TEXT NOT NULL,
  day_key     TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, day_key)
);
