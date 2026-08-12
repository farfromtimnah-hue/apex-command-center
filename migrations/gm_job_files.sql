-- Widen gm_job_photos to hold PDFs as well as images.
--
-- ⚠️ THE TABLE NAME PREDATES THIS CHANGE. gm_job_photos now stores documents
-- too -- the client asked for PDFs on projects after photos were already
-- shipping and in use. It is deliberately NOT renamed: the rename would touch
-- every handler, index and route path (/gm/jobs/:id/photos/...) for a cosmetic
-- gain, and a half-applied rename against live rows is a real outage against
-- an imaginary problem. Read "photos" as "attachments" throughout.
--
-- WHY THESE COLUMNS. The gallery assumed every row was an image, because
-- until now every row was. A PDF has no thumbnail, so the UI needs to know
-- what a row IS (content_type) and what to call it (file_name) -- a PDF row
-- shows its original filename, since one red icon looks like every other.
--
-- BOTH NULLABLE, and that is the point: SQLite cannot add a NOT NULL column
-- without a default, and inventing a default would write a fact about rows
-- nobody checked. Existing rows are backfilled below to what they provably
-- are -- images -- and the handlers treat NULL as an image anyway, so a row
-- that somehow escapes the backfill still renders exactly as it does today.
--
-- Client-visible by design, unchanged: see the comment block in
-- gm_job_photos.sql. Still hidden from sellers by absence from
-- sellerRequestAllowed().

ALTER TABLE gm_job_photos ADD COLUMN content_type TEXT;
ALTER TABLE gm_job_photos ADD COLUMN file_name    TEXT;

-- Backfill: every row that exists when this runs is an image, uploaded
-- through a handler whose allowlist was images-only (JOB_PHOTO_TYPES had no
-- application/pdf until the commit that ships this file).
--
-- The type is recovered from the extension the upload handler itself wrote
-- into r2_key -- that key was built as job-photos/<clientId>/<photoId>.<ext>
-- from a validated allowlist, so the extension is trustworthy here in a way a
-- user-supplied filename would not be. 'jpg' covers the jpeg alias the
-- handler collapses into it.
UPDATE gm_job_photos
SET content_type = CASE
      WHEN lower(r2_key) LIKE '%.png'  THEN 'image/png'
      WHEN lower(r2_key) LIKE '%.gif'  THEN 'image/gif'
      WHEN lower(r2_key) LIKE '%.webp' THEN 'image/webp'
      WHEN lower(r2_key) LIKE '%.heic' THEN 'image/heic'
      ELSE 'image/jpeg'   -- .jpg / .jpeg, and the safe default: these are images
    END
WHERE content_type IS NULL;

-- file_name is left NULL for existing rows on purpose. The original upload
-- name was never captured, so there is nothing true to put here; the UI falls
-- back to the thumbnail for images, which is what these all are.
