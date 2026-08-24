CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    client_id   TEXT,
    date        TEXT NOT NULL,
    time        TEXT,
    session_type      TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    raw_transcript TEXT,
    summary_json   TEXT,
    pdf_data          TEXT,
    task_completions  TEXT,
    approved_at       TEXT,
    google_meet_link  TEXT,
    whatsapp_sent_at  TEXT,
    section_config    TEXT,
    meeting_category  TEXT NOT NULL DEFAULT 'client',
    location          TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- meeting_category was added to the live sessions table via
-- migrations/session_meeting_category.sql. 'client' or 'prospective'
-- (a meeting with a lead, not yet a real client) -- stored per-session,
-- not inferred from the client's current status. 'event' (added with the
-- calendar Event/Apex Club entry types) marks a non-client calendar entry:
-- client_id is NULL and client_name holds the event name.
-- NOTE: location was added to the live sessions table via
-- migrations/session_location.sql. Free-text street address for in-person
-- sessions and events; feeds the detail modal's Directions maps link.
-- NOTE: series_id was added to the live sessions table via
-- migrations/session_series.sql. Apex's own UUID linking the occurrences of
-- a recurring series created by the calendar. NULL = standalone (including
-- every row created before the migration -- membership is stored, never
-- inferred). For an online_meet series every row shares one google_event_id:
-- the recurring Google master event carrying the RRULE.
-- NOTE: section_config was added to the live sessions table via
-- migrations/session_section_config.sql. JSON: {"sections":[{key,enabled,order}x9],
-- "custom_sections":[{id,title_pt,title_en,description,enabled,order}]}.
-- Null = default (all nine standard sections enabled, no custom sections).
-- Cover and Executive Summary never appear here — always rendered.

CREATE TABLE IF NOT EXISTS session_summaries (
    id                        TEXT PRIMARY KEY,
    session_id                TEXT NOT NULL UNIQUE,
    summary_pt                TEXT,
    summary_en                TEXT,
    recommendations_pt        TEXT,
    recommendations_en        TEXT,
    client_action_items_pt    TEXT,
    client_action_items_en    TEXT,
    rafa_followups_pt         TEXT,
    rafa_followups_en         TEXT,
    next_session_focus_pt     TEXT,
    next_session_focus_en     TEXT,
    client_profile_updates_pt TEXT,
    client_profile_updates_en TEXT,
    business_diagnosis_pt     TEXT,
    business_diagnosis_en     TEXT,
    swot_synthesis_pt         TEXT,
    swot_synthesis_en         TEXT,
    thirty_day_goals_pt       TEXT,
    thirty_day_goals_en       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- NOTE: business_diagnosis_*, swot_synthesis_*, thirty_day_goals_* were added to the
-- live D1 database via migrations/session_summaries_report_sections.sql.
-- business_diagnosis_pt/en: JSON array of 10 {dimension, situation, level} rows.
-- swot_synthesis_pt/en: JSON object {forca_oportunidade, fraqueza_ameaca, forca_ameaca}.
-- thirty_day_goals_pt/en: JSON array of 7 {area, meta, indicador} rows.

CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL UNIQUE,
    pdf_data    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    owners         TEXT,
    industry       TEXT,
    location       TEXT,
    logo_url       TEXT,
    profile_pt     TEXT,
    profile_en     TEXT,
    package        TEXT,
    status         TEXT DEFAULT 'active',
    phone          TEXT,
    email          TEXT,
    whatsapp       TEXT,
    payment_method    TEXT,
    contacts          TEXT,
    digital_presence  TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
-- NOTE: payment_method, contacts, and digital_presence were added to the live D1 database via:
--   ALTER TABLE clients ADD COLUMN payment_method TEXT;
--   ALTER TABLE clients ADD COLUMN contacts TEXT;
--   ALTER TABLE clients ADD COLUMN digital_presence TEXT;
-- contacts stores a JSON array of {name, role, phone, whatsapp, email} objects.
-- digital_presence stores a JSON object keyed by platform name → {url, notes:[{date,working,needs_improvement}]}

-- NOTE: lead_stage was added to the live clients table via migrations/lead_pipeline.sql:
--   ALTER TABLE clients ADD COLUMN lead_stage TEXT;
-- Pipeline position of a status='lead' row. Fixed ladder, never configurable:
--   Lead | Contato inicial | Raio X enviado | Raio X recebido | Agendamento
-- Auto-advanced as a side effect of real actions (first lead_contact_log row,
-- client_assessments activation, assessment completion, session creation) but
-- always manually overridable with a warning, so the column -- not inference --
-- is the source of truth. NULL = a lead predating the migration; read as 'Lead'.
-- The two terminal outcomes are clients.status changes, NOT lead_stage values:
--   became a client      -> status='active' (+package), leaves the Leads tab
--   did not move forward -> status='lead_dormant'
-- NOTE: 'lead_dormant' is a clients.status value added by the same migration
-- (no schema change -- status is free-text TEXT). Shown in the Consolidados tab
-- under "Leads para reativar" / "Leads to reactivate", stacked ABOVE the
-- status='closed' rows ("Clientes consolidados"). Never labelled "lost": these
-- are revisitable, and Rafa periodically works the list to revive them.
-- No archived_from column was needed -- status alone separates the two groups,
-- so pre-existing 'closed' rows were left untouched.

-- NOTE: consolidated was added to the live D1 database via migrations/client_consolidated.sql:
--   ALTER TABLE clients ADD COLUMN consolidated INTEGER NOT NULL DEFAULT 0;
-- Manual-only flag (never automatic) toggled on the client profile page to move a
-- client from the "Active" tab to the "Consolidados" tab on clients.html.

-- NOTE: source_type and source_detail were added to the live clients table via
-- migrations/client_source.sql:
--   ALTER TABLE clients ADD COLUMN source_type TEXT;
--   ALTER TABLE clients ADD COLUMN source_detail TEXT;
-- Where the client came from, kept for their whole lifecycle -- set on the lead
-- and carried through conversion, never reset. source_type is a constrained set
-- (partner | referral_client | direct | event | social | other) validated in the
-- worker, because it is what future source-attribution metrics will GROUP BY.
-- NULL = genuinely unknown, never backfilled to a guessed default.
-- source_detail is free text for the specifics ("Instagram DM", the name of a
-- referring client, "Apex Club").
-- When source_type = 'partner', referred_by_partner_id (added by
-- migrations/apex_partners.sql) stays AUTHORITATIVE and the partner's name is
-- resolved by join against apex_partners at read time -- it is never copied
-- into source_detail. Attribution is by record, never by typed name.

-- NOTE: stage_changed_by and stage_change_source were added to the live clients
-- table via migrations/lead_pipeline_actor_attribution.sql:
--   ALTER TABLE clients ADD COLUMN stage_changed_by TEXT;
--   ALTER TABLE clients ADD COLUMN stage_change_source TEXT;
-- WHO last moved the lead's stage, and whether a human chose to. Written by
-- both writers in the same statement as lead_stage/stage_changed_at, so the
-- four can never drift apart. stage_changed_by holds the DISPLAY NAME
-- ('Alice' / 'Rafa'), matching client_assessments.activated_by,
-- lead_contact_log.logged_by and clients.next_step_set_by -- always
-- server-derived, never trusted from a request body.
-- stage_change_source is a stable machine token the UI maps to PT/EN prose:
--   manual | auto:contact_logged | auto:xray_assigned | auto:xray_submitted
--   | auto:session_scheduled
-- The 'auto:' prefix is the load-bearing distinction: an automatic advance
-- reading as somebody's deliberate decision is what made one stage change
-- impossible to attribute after the fact. On an auto row the name is the person
-- whose action TRIGGERED the bump, not someone who picked the stage.
-- On auto:xray_submitted the actor is normally the CLIENT (that handler is
-- requireClientAccess, not admin), recorded as the literal 'client'.
-- NULL = a row predating the migration, never backfilled to a guess.
-- Untouched when a write is a no-op (advanceLeadStage's forward-only early
-- return, or re-picking the current stage): the columns describe the last REAL
-- change, so a second session booked by Rafa on a lead already at "Agendamento"
-- leaves Alice's name on the move that actually happened.

-- NOTE: created_by was added to the live sessions table via
-- migrations/lead_pipeline_actor_attribution.sql:
--   ALTER TABLE sessions ADD COLUMN created_by TEXT;
-- Who created the booking. Three writers, only one of them a person:
-- the schedule endpoint stores the authenticated admin's display name, while
-- the Fireflies transcript ingest stores 'fireflies' and the Google Calendar
-- sync stores 'google_calendar'. The machine paths are named honestly rather
-- than left NULL because we DO know what created those rows; NULL stays
-- reserved for the genuinely unknown pre-migration rows and is never
-- backfilled.

-- NOTE: created_by was added to the live client_logins table via
-- migrations/lead_pipeline_actor_attribution.sql:
--   ALTER TABLE client_logins ADD COLUMN created_by TEXT;
-- The admin display name stamped when a portal login is CREATED. Deliberately
-- not re-stamped on a password reset: the column answers "who let this client
-- in", which a later reset by someone else does not change. Not backfilled.

-- NOTE: task_completions was added to the live sessions table via:
--   ALTER TABLE sessions ADD COLUMN task_completions TEXT;
-- Stores a JSON object keyed by task key (e.g. "rafa_0", "client_1") → boolean.

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    type        TEXT NOT NULL,       -- 'client' | 'consultant'
    description TEXT NOT NULL,
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done'
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_notes (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_by  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- NOTE: lead_contact_log was added via migrations/lead_pipeline.sql. Running
-- history of outreach attempts against a lead. DISTINCT FROM client_notes and
-- never merged with it: a client_notes row is a general note about the client,
-- a lead_contact_log row is one outreach attempt with its own method/result.
-- Both must continue to exist independently.
-- CREATE TABLE IF NOT EXISTS lead_contact_log (
--   id         TEXT PRIMARY KEY,
--   client_id  TEXT NOT NULL,
--   method     TEXT NOT NULL,  -- WhatsApp | Phone call | Email | In person | Text message
--   result     TEXT NOT NULL,  -- No response | Answered | Left voicemail | Rescheduled | Not interested
--   notes      TEXT,           -- optional, on every entry, never gated by result
--   logged_by  TEXT,
--   logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
-- );
-- The five method and five result values are FINAL -- do not extend either list.
-- Inserting the FIRST row for a client auto-advances lead_stage to 'Contato inicial'.

CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    role  TEXT NOT NULL
);
-- NOTE: client_id TEXT was added to the live users table via
-- migrations/client_portal.sql. Set only for role='client' rows (links a
-- Google sign-in to a clients.id). NULL for alice/rafa/developer.
-- NOTE: Client Portal tables (client_daily_entries, client_field_config,
-- client_missed_days, client_logins, client_auth_tokens) were added via
-- migrations/client_portal.sql — see that file for shapes and JSON formats.

-- Seed: operational account for Alice
INSERT OR IGNORE INTO users (email, role) VALUES ('abnerprata@gmail.com', 'alice');

-- NOTE: packages table and message_templates were added via migrations/ files.
-- NOTE: Resource Hub tables (resources, client_resources, resource_categories)
-- were added via migrations/resources.sql.
-- NOTE: client_growth_entries (Sales Dashboard / monthly client growth tracking)
-- was added via migrations/client_growth_entries.sql:
-- CREATE TABLE IF NOT EXISTS client_growth_entries (
--   id             TEXT PRIMARY KEY,
--   client_id      TEXT NOT NULL,
--   month_label    TEXT NOT NULL,           -- 'YYYY-MM'
--   growth_percent REAL NOT NULL,
--   entered_by     TEXT,
--   entered_at     TEXT NOT NULL DEFAULT (datetime('now')),
--   UNIQUE (client_id, month_label)
-- );
-- raw_json TEXT added via migrations/client_growth_entries_raw_json.sql
-- (baseline/current line items behind growth_percent; NULL = percent-only entry).
-- packages table (with pricing fields added via migrations/package_pricing.sql):
-- CREATE TABLE IF NOT EXISTS packages (
--   id                  TEXT PRIMARY KEY,
--   short_name          TEXT NOT NULL,
--   full_name           TEXT NOT NULL,
--   audience            TEXT,
--   included_items      TEXT,
--   is_popular          INTEGER NOT NULL DEFAULT 0,
--   sort_order          INTEGER,
--   base_price          REAL,
--   has_payment_plan    INTEGER NOT NULL DEFAULT 0,
--   installment_count   INTEGER,
--   installment_amount  REAL
-- );
