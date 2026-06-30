CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    date        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    raw_transcript TEXT,
    summary_json   TEXT,
    approved_at    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    role  TEXT NOT NULL
);

-- Seed: operational account for Pra. Alice
INSERT OR IGNORE INTO users (email, role) VALUES ('abnerprata@gmail.com', 'alice');
