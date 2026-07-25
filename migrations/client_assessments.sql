-- Business X-Ray, Part 1 (2026-07-25): generic assessment assignment.
-- Fully additive — no existing table is modified.
--
-- One row per (client_id, assessment_type). A row existing = the assessment
-- is activated for that client/lead (mirrors the client_logins "existence is
-- the flag" pattern). assessment_type is 'business_xray' today; a second
-- assessment type can be assigned later with zero schema change.
--
-- answers_json: flat { "<question_key>": 1 | 0 } map, autosaved partially by
-- the portal (drafts merge, never require completion). The question bank
-- itself lives in the Worker (XRAY_QUESTIONS) — only answers are stored.
-- score_json: the full scoring-engine output (computeXrayScore) frozen at
-- submit time, so the report never re-scores against a later question bank.
-- status: 'not_started' | 'in_progress' | 'completed' — recomputed by the
-- Worker on every answer write; completed_at stamped once on submit.
CREATE TABLE IF NOT EXISTS client_assessments (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  assessment_type TEXT NOT NULL,             -- 'business_xray'
  status          TEXT NOT NULL DEFAULT 'not_started',
  answers_json    TEXT NOT NULL DEFAULT '{}',
  score_json      TEXT,
  activated_by    TEXT,
  activated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at      TEXT,
  completed_at    TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, assessment_type)
);
CREATE INDEX IF NOT EXISTS idx_ca_client ON client_assessments (client_id);
