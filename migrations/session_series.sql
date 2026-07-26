-- Links occurrences of a recurring series created by the calendar's New
-- Session modal. NULL for standalone sessions and for every row created
-- before this migration (those were never a series -- membership is stored,
-- never inferred from client/time/spacing heuristics).
--
-- For an online_meet series, google_event_id on every row of the series
-- holds the SAME Google Calendar event id: the recurring master event
-- created with an RRULE (Google generates the instances). series_id is
-- Apex's own UUID for the series.
ALTER TABLE sessions ADD COLUMN series_id TEXT;
