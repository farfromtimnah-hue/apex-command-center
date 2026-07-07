-- Resource Hub (Documents page) — resources library + per-client assignment/send tracking.
-- Spec: build-spec.md → "RESOURCE HUB — DOCUMENTS PAGE".

CREATE TABLE IF NOT EXISTS resources (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  resource_type TEXT NOT NULL,             -- 'contact' | 'file' | 'link'
  title         TEXT NOT NULL,
  description   TEXT,
  contact_name  TEXT,                      -- type=contact only
  contact_phone TEXT,
  contact_email TEXT,
  file_url      TEXT,                      -- type=file only (R2 key served via Worker)
  file_name     TEXT,
  url           TEXT,                      -- type=link only
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_resources (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  resource_id      TEXT NOT NULL,
  assigned_at      TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by      TEXT,
  whatsapp_sent_at TEXT,                   -- null = pending, timestamp = sent (this IS the checkmark)
  sent_by          TEXT
);

-- Controlled-but-self-extending category vocabulary: the fixed list is seeded here,
-- and choosing "Other" in the UI inserts the typed value as a new row (INSERT OR IGNORE),
-- so the dropdown grows to match real usage.
CREATE TABLE IF NOT EXISTS resource_categories (
  name       TEXT PRIMARY KEY,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO resource_categories (name, sort_order) VALUES
  ('Legal', 1),
  ('Marketing/Digital Presence', 2),
  ('Vendors/Suppliers', 3),
  ('HR/Recruiting', 4),
  ('Financial', 5),
  ('Operations/Process', 6),
  ('Networking/Referrals', 7);
