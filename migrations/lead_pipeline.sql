-- Lead Pipeline / CRM (2026-07-27): Apex's OWN sales pipeline around the
-- prospect records Alice and Rafa already create as clients.status = 'lead'.
--
-- DATA TIER NOTE: this is the consultancy's own prospect flag on the clients
-- table. Completely unrelated to gm_leads (migrations/gm_growth_management.sql),
-- which holds the CLIENT's own customers one tier below. Same word, different
-- tier -- do not join or conflate them.
--
-- lead_stage: the pipeline position of a clients.status='lead' row.
-- Fixed six-value ladder, never configurable (mirrors the GM method's fixed
-- stage list). Stored, never inferred -- the system auto-advances it as a side
-- effect of real actions (first contact logged, X-Ray assigned, X-Ray
-- submitted, session scheduled), but a human can always override with a
-- warning, so the column is the single source of truth.
--
--   Lead              -- default for every new lead
--   Contato inicial   -- auto: first lead_contact_log row for this client
--   Raio X enviado    -- auto: client_assessments row created for this client
--   Raio X recebido   -- auto: that assessment reaches status='completed'
--   Agendamento       -- auto: a session row is created for this client
--   (terminal states are NOT lead_stage values -- see below)
--
-- The two terminal outcomes deliberately leave lead_stage behind and change
-- clients.status instead, because the record stops being a live lead:
--   became a client      -> status='active'  (+ a package), leaves the Leads tab
--   did not move forward -> status='lead_dormant', shown in Consolidados
--
-- NULL lead_stage = a lead created before this migration; the app treats NULL
-- as the first stage ('Lead') at read time rather than backfilling, so a row
-- that never moved is distinguishable from one explicitly set to 'Lead'.
ALTER TABLE clients ADD COLUMN lead_stage TEXT;

-- 'lead_dormant' is a clients.status value, not a lead_stage value.
--
-- Naming is deliberate and load-bearing: these are leads that did not convert
-- YET. Rafa revisits this list periodically to revive them, so the UI heading
-- is "Leads para reativar" / "Leads to reactivate" -- never "lost". Same
-- reasoning that named the Consolidados tab: a closed record is not a broken
-- relationship. The dormant framing matches gm_base_ouro's existing
-- "cliente antigo" / dormant-customer reactivation vocabulary (gm.js).
--
-- No archived_from column is needed: clients.status alone distinguishes the
-- two groups inside the Consolidados tab, so the 6 pre-existing status='closed'
-- rows are left completely untouched by this migration.
--   status='lead_dormant' -> "Leads para reativar"    (revisitable, listed first)
--   status='closed'       -> "Clientes consolidados"  (reference)

-- Running history of contact attempts against a lead. Separate from and
-- unrelated to client_notes: a client_notes row is a general note about the
-- client, a lead_contact_log row is one specific outreach attempt with its
-- own method/result. Both exist independently and neither replaces the other.
--
-- notes is nullable and always available regardless of method/result -- it is
-- never gated to a particular result value.
--
-- logged_by / logged_at follow the client_notes convention exactly:
-- server-set, derived from the authenticated user, never trusted from the
-- client and never user-editable.
CREATE TABLE IF NOT EXISTS lead_contact_log (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  method     TEXT NOT NULL,   -- WhatsApp | Phone call | Email | In person | Text message
  result     TEXT NOT NULL,   -- No response | Answered | Left voicemail | Rescheduled | Not interested
  notes      TEXT,            -- optional, present on every entry
  logged_by  TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lcl_client ON lead_contact_log (client_id, logged_at);
