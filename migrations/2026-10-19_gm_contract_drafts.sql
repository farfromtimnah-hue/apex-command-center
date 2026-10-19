-- Task 5.1: contract drafts, autosaved as the person types. ONE open draft
-- per (client_id, source) -- source is 'apex' (standard template) or
-- 'client' (the business's own, converted template, task 5.2). Starting a
-- new contract while one is open resumes it instead of creating a second.
-- A version counter guards the write so two open tabs can never silently
-- overwrite each other with an older save (the UPDATE's WHERE compares the
-- version it read against the one it is about to write).
--
-- voided_at marks history (a draft replaced by a real gm_contracts row, or
-- abandoned) -- never a hard delete, per rule 5.
CREATE TABLE IF NOT EXISTS gm_contract_drafts (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'apex',
  answers_json TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_gm_contract_drafts_client ON gm_contract_drafts (client_id, source, voided_at);
