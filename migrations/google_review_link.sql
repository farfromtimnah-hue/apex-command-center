-- Job 37: ask for a Google review from the project.
--
-- ADD ONLY. Nothing existing is changed or deleted, and no data is written.
-- Safe to run before or after the Worker that reads it is deployed: that
-- Worker treats a missing column as "no link saved yet" and a missing table
-- as "no press recorded yet".
--
-- Run each statement once. The ALTER fails with "duplicate column name" if it
-- is run a second time; that error is harmless.

-- 1. The business's own Google review link, saved once by the owner in the
--    document settings. NULL = not set.
ALTER TABLE gm_doc_settings ADD COLUMN google_review_link TEXT;

-- 2. One row per press of a send button (WhatsApp, text message or copy).
--    Built for every send button; today only kind = 'review_request' writes
--    here. It records the PRESS only: nobody can know whether the customer
--    wrote the review, so there is no "reviewed" status.
--      kind           'review_request' (others later: contact_card, estimate, ...)
--      channel        'whatsapp' | 'sms' | 'copy'
--      project_id     gm_jobs.id   (NULL for a send that has no project)
--      lead_id        gm_leads.id  (NULL when the project has no lead)
--      actor_user_id  the login that pressed (username or email)
--      actor_name     the display name shown in "Review requested ... by ..."
CREATE TABLE IF NOT EXISTS gm_send_log (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  kind           TEXT NOT NULL,
  project_id     TEXT,
  lead_id        TEXT,
  channel        TEXT NOT NULL,
  actor_user_id  TEXT,
  actor_name     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_send_log_project ON gm_send_log (client_id, kind, project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gm_send_log_lead ON gm_send_log (client_id, kind, lead_id, created_at);
