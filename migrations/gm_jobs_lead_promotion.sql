-- Lead -> project promotion (2026-09-16).
--
-- A won lead BECOMES a project, the same way an Apex lead becomes an active
-- client: one record moving forward, not a second record created alongside it.
-- gm_leads and gm_jobs already share the cost columns (they were named to match
-- so gmJobComputed could run over either), so the promotion is a field copy.
--
-- lead_id is the link back, and the UNIQUE index is what makes promoting twice
-- impossible at the database rather than in a handler somebody can bypass:
-- SQLite allows many NULLs in a UNIQUE column, so hand-made projects are
-- unaffected while a promoted lead can never produce a second project.
ALTER TABLE gm_jobs ADD COLUMN lead_id TEXT REFERENCES gm_leads(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_jobs_lead_id
  ON gm_jobs(lead_id) WHERE lead_id IS NOT NULL;
