-- Lead Pipeline: actor attribution — "who did this" (2026-07-27).
-- Additive only. Nothing existing is modified or dropped.
--
-- WHY THIS EXISTS: a lead moved from "Raio X recebido" to "Agendamento" and
-- there was no way to answer who moved it. Reconstructing it meant matching
-- timestamps to the second across three tables — which revealed the stage
-- change was AUTOMATIC (advanceLeadStage fired when a session was scheduled),
-- while the underlying action was deliberate and by an unknown person.
--
-- That is the distinction these columns encode. Knowing a stage moved is not
-- the same as knowing a PERSON moved it, and the earlier confusion was
-- precisely an automatic change reading as somebody's decision.
--
-- DATA TIER NOTE (repeated deliberately, as in lead_pipeline_stage_duration):
-- these columns belong to the APEX-INTERNAL pipeline over clients.status='lead'.
-- They are unrelated to gm_leads, which lives one tier below on the CLIENT's
-- own customers. Same concepts, different tier — never join.

-- ---------------------------------------------------------------------------
-- clients: who last moved the stage, and whether a human chose to.
-- ---------------------------------------------------------------------------

-- The DISPLAY NAME ('Alice' / 'Rafa' / 'Nicole') of the acting user, following
-- the convention already set by client_assessments.activated_by,
-- lead_contact_log.logged_by, resources.created_by and clients.next_step_set_by.
-- Server-derived from the authenticated user (user.display_name || user.role),
-- never trusted from a request body and never user-editable.
--
-- Populated on BOTH paths — the automatic advance and the manual override —
-- because "who" is a real question in both cases. On an automatic advance this
-- names the person whose action triggered the bump (whoever scheduled the
-- session), which is exactly the name the incident above could not produce.
ALTER TABLE clients ADD COLUMN stage_changed_by TEXT;

-- Whether the last stage change was a deliberate pick or a side effect, and if
-- a side effect, of WHICH action:
--
--   'manual'                 -- someone chose the stage from the dropdown
--   'auto:contact_logged'    -- first contact logged     -> Contato inicial
--   'auto:xray_assigned'     -- Business X-Ray assigned  -> Raio X enviado
--   'auto:xray_submitted'    -- Business X-Ray submitted -> Raio X recebido
--   'auto:session_scheduled' -- session booked           -> Agendamento
--
-- Stored as a stable machine token, not display text: the UI maps it to PT/EN
-- prose, so wording can change without a data migration and without breaking
-- the 'auto:' prefix test that separates automatic from manual.
ALTER TABLE clients ADD COLUMN stage_change_source TEXT;

-- ---------------------------------------------------------------------------
-- sessions: who created the booking.
-- ---------------------------------------------------------------------------

-- NOT BACKFILLED, deliberately. Existing rows genuinely have unknown
-- authorship and inventing one would be worse than NULL — the whole point of
-- this migration is that a confident wrong answer is what caused the incident.
-- NULL reads as "unknown", which is true.
--
-- Three writers, and only one of them is a person:
--   POST /api/sessions/schedule   -> the authenticated admin's display name
--   Fireflies transcript ingest   -> 'fireflies' (a machine, honestly named)
--   Google Calendar sync          -> 'google_calendar' (likewise)
-- The two machine paths are named rather than left NULL because we DO know who
-- created those rows; it just isn't a human. NULL stays reserved for the
-- genuinely unknown pre-migration rows.
ALTER TABLE sessions ADD COLUMN created_by TEXT;

-- ---------------------------------------------------------------------------
-- client_logins: who issued the portal login.
-- ---------------------------------------------------------------------------

-- Stamped when an admin creates a portal login. Set on creation only, never on
-- a password RESET: the column answers "who let this client in", and a later
-- reset by someone else does not change that fact. Not backfilled, same
-- reasoning as sessions.created_by.
ALTER TABLE client_logins ADD COLUMN created_by TEXT;
