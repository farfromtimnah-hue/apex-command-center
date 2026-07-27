-- Lead Pipeline: stage duration + next step with attribution (2026-07-27).
-- Additive only — extends the clients table that migrations/lead_pipeline.sql
-- already flagged with lead_stage. Nothing existing is modified or dropped.
--
-- DATA TIER NOTE (repeated deliberately): these columns belong to the
-- APEX-INTERNAL pipeline over clients.status='lead'. They are unrelated to
-- gm_leads.stage_changed_at / gm_leads.proxima_acao, which live one tier below
-- on the CLIENT's own customers. Same concepts, different tier — never join.

-- When the lead last MOVED to its current lead_stage. Drives the
-- "X day(s) in this stage" display next to the stage pill.
--
-- Mirrors the convention gm_leads.stage_changed_at established in
-- migrations/gm_growth_management.sql:71 (which was schema-only groundwork and
-- was never wired to a UI); this is the first real "days in stage" display.
--
-- Stamped ONLY when lead_stage actually changes value — both writers
-- (advanceLeadStage's forward-only bump and handlePatchLeadStage's manual
-- override) already return early when the stage is unchanged, so an unrelated
-- client edit can never reset the clock. A row that predates this migration has
-- NULL here; the UI reads NULL as "unknown" and shows no day count rather than
-- pretending the lead entered its stage the moment the column was added.
--
-- No DEFAULT datetime('now'): in SQLite a non-constant default on ALTER TABLE
-- ADD COLUMN is rejected, and a backfilled "now" for every pre-existing lead
-- would be a lie. New rows are stamped explicitly by the Worker instead.
ALTER TABLE clients ADD COLUMN stage_changed_at TEXT;

-- The single "what happens next on this lead" line, with attribution, so Rafa
-- can see at a glance what Alice committed to (and vice versa) on a hard lead.
--
-- next_step_set_by stores the DISPLAY NAME ('Alice' / 'Rafa'), following the
-- activated_by convention on client_assessments and logged_by on
-- lead_contact_log — server-derived from the authenticated user, never trusted
-- from the request body and never user-editable.
--
-- All three columns are written together in ONE statement on every edit: a
-- next_step without its author or timestamp is meaningless, so they can never
-- drift apart. Both Alice and Rafa (any isAdminRole) can edit — deliberately
-- NOT restricted to whoever set it last, since the point is that either can
-- step in on the other's lead.
ALTER TABLE clients ADD COLUMN next_step TEXT;
ALTER TABLE clients ADD COLUMN next_step_set_by TEXT;
ALTER TABLE clients ADD COLUMN next_step_set_at TEXT;
