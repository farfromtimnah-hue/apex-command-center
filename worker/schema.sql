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
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
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

CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    role  TEXT NOT NULL
);

-- Seed: operational account for Pra. Alice
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
