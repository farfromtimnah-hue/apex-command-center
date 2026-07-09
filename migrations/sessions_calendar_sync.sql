-- New columns needed to persist externally-sourced Google Calendar events
-- as real `sessions` rows (calendar sync-back Phase 2).
--
-- NOTE: google_event_id and calendar_provider already existed live on the
-- remote DB prior to this migration (added ad-hoc via wrangler d1 execute
-- in Phase 1, never captured in a migration file). Not repeated here to
-- avoid a duplicate-column error on the already-migrated remote DB.

ALTER TABLE sessions ADD COLUMN html_link TEXT;
ALTER TABLE sessions ADD COLUMN end_time TEXT;
ALTER TABLE sessions ADD COLUMN attendees TEXT;
