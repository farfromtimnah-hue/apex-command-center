-- Attachments on a LEAD (gm_leads).
--
-- Asked for by Rafa in the client's words: he wants to archive "PDF ou fotos"
-- against a lead -- the signed estimate, a permit, photos of the job site
-- someone sent over WhatsApp. gm_leads had nowhere to put any of it.
--
-- Modelled deliberately on gm_job_photos (migrations/gm_job_photos.sql), one
-- tier over, and carrying the same safety properties on purpose:
--
--   * The R2 object is the source of truth for the bytes; this row is the
--     index. Deleting a row without deleting r2_key orphans the object, so
--     the delete handler removes BOTH, R2 first.
--   * Every read is scoped by client_id as well as lead_id, so a guessed
--     lead_id from another business is a 404 rather than a served file.
--   * The r2_key shape is re-validated with a strict regex on read and
--     delete: R2 is never handed a path shape we did not write ourselves.
--
-- WHERE THIS DIFFERS FROM gm_job_photos: that table predates PDFs and stores
-- images only, so it carries no content_type. This one accepts PDFs from the
-- start, so content_type is NOT NULL -- it decides whether the UI draws a
-- thumbnail or a file row, and guessing that from the extension after the
-- fact is exactly the migration gm_job_files.sql has to perform.
--
-- SELLERS CANNOT SEE THESE. Nothing here enforces it and nothing here needs
-- to: sellerRequestAllowed() is a strict allowlist and these routes are
-- simply absent from it, so a seller session is refused before reaching any
-- handler. Adding a lead-file route to that allowlist would be the mistake.

CREATE TABLE IF NOT EXISTS gm_lead_files (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT NOT NULL REFERENCES gm_leads(id) ON DELETE CASCADE,
  -- Denormalised from the lead so every read can scope by client without a
  -- join, and so a file can never be served against the wrong client even if
  -- a lead_id is guessed. Same reasoning as gm_job_photos.client_id.
  client_id    TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  -- The name the file arrived with. Shown for PDFs, where "estimate-jm.pdf"
  -- is the only thing distinguishing one red icon from another; an image is
  -- identified by its own thumbnail and rarely needs it.
  file_name    TEXT,
  content_type TEXT NOT NULL,
  caption      TEXT,
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The attachment list reads by lead, oldest first (an upload history reads
-- chronologically, same as the project gallery).
CREATE INDEX IF NOT EXISTS idx_gm_lead_files_lead
  ON gm_lead_files (lead_id, created_at);

-- Every client-scoped read filters on this.
CREATE INDEX IF NOT EXISTS idx_gm_lead_files_client
  ON gm_lead_files (client_id);
