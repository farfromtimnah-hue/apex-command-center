-- Who last edited a session, and when. sessions.created_by already records
-- who scheduled it; these answer the separate question "who changed this
-- meeting?" once the calendar Edit modal can change every field.
--
-- Additive only, no backfill: NULL means the row has not been edited since
-- this migration landed. That is honest -- a backfilled value would have to
-- be invented, and the July "who moved BRAX FACILITIES?" investigation was
-- painful precisely because timestamps were being inferred rather than
-- recorded.
--
-- updated_at is written by the worker as an ISO-8601 UTC string (the same
-- shape created_at carries), never by a SQL DEFAULT -- a DEFAULT would fire
-- on every UPDATE anywhere in the codebase, including the transcript
-- ingestion paths, and would misreport machine writes as human edits.

ALTER TABLE sessions ADD COLUMN updated_at TEXT;
ALTER TABLE sessions ADD COLUMN updated_by TEXT;
