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
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

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
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

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
