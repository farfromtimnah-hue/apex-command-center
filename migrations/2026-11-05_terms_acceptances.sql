-- Adults only and business use confirmation, 2026-11-05. ADDITIVE ONLY.
--
-- One row per person, per terms version, per kind. Nothing else about the
-- person is stored: no birthdate, no name, no contact detail.
--   user_id       'u:<email>' for a staff sign in, 'l:<username>' for a client
--                 tier sign in. Taken from the verified session, never a body.
--   client_id     the business, NULL for staff.
--   accepted_at   UTC ISO timestamp.
--   terms_version a text constant defined once in the Worker (TERMS_VERSION).
--   kind          'adult_business'
--   source        'invite' (new invitation) or 'existing' (card after sign in)
-- The unique key lets the Worker use INSERT OR IGNORE, so a retry never writes twice.
CREATE TABLE IF NOT EXISTS terms_acceptances (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  client_id     TEXT,
  accepted_at   TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('adult_business')),
  source        TEXT NOT NULL CHECK (source IN ('invite', 'existing')),
  UNIQUE (user_id, terms_version, kind)
);
