CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    client_id   TEXT,
    date        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    raw_transcript TEXT,
    summary_json   TEXT,
    pdf_data       TEXT,
    approved_at    TEXT,
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
    payment_method TEXT,
    contacts       TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
-- NOTE: payment_method and contacts were added to the live D1 database via:
--   ALTER TABLE clients ADD COLUMN payment_method TEXT;
--   ALTER TABLE clients ADD COLUMN contacts TEXT;
-- contacts stores a JSON array of {name, role, phone, whatsapp, email} objects.

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
