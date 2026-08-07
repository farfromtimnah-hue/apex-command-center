-- Progress photos on a project (gm_jobs).
--
-- Asked for by Rafa: for a pool builder the project is a physical site, and
-- progress photos are what an owner shows their own customer. So these are
-- CLIENT-VISIBLE by design.
--
-- Sellers cannot see them. That is not enforced here but in
-- sellerRequestAllowed(), which is a strict allowlist: a route that is not
-- listed is refused. These routes are deliberately absent from it.
--
-- The R2 object is the source of truth for the image bytes; this row is the
-- index. Deleting a row without deleting r2_key would orphan the object, so
-- the delete handler removes both.

CREATE TABLE IF NOT EXISTS gm_job_photos (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES gm_jobs(id) ON DELETE CASCADE,
  -- Denormalised from the job so every read can scope by client without a
  -- join, and so a photo can never be served against the wrong client even
  -- if a job_id is guessed.
  client_id   TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  caption     TEXT,
  uploaded_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The gallery reads by job, newest last (progress reads chronologically).
CREATE INDEX IF NOT EXISTS idx_gm_job_photos_job
  ON gm_job_photos (job_id, created_at);

-- Every client-scoped read filters on this.
CREATE INDEX IF NOT EXISTS idx_gm_job_photos_client
  ON gm_job_photos (client_id);
