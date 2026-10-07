-- Job 40: the owner can state that the work requires no state contractor
-- license, so estimate setup can be finished without a license number.
--
-- ADD ONLY. Nothing existing is changed or deleted, and no data is written:
-- every business starts with the box unticked (0), exactly as today.
-- Safe to run before or after the Worker that reads it is deployed: that
-- Worker treats missing columns as "box not ticked" and refuses a tick with a
-- plain message until the columns exist.
--
-- Run each statement once. An ALTER fails with "duplicate column name" if it
-- is run a second time; that error is harmless.

-- 1. The owner's statement. 0 = not stated (the default), 1 = stated.
ALTER TABLE gm_doc_settings ADD COLUMN license_not_required INTEGER NOT NULL DEFAULT 0;

-- 2. Who ticked the box: the same display name the settings history records.
--    NULL while the box is not ticked.
ALTER TABLE gm_doc_settings ADD COLUMN license_not_required_by TEXT;

-- 3. When it was ticked (UTC, 'YYYY-MM-DD HH:MM:SS'). NULL while not ticked.
ALTER TABLE gm_doc_settings ADD COLUMN license_not_required_at TEXT;
