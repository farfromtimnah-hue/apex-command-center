-- Distinguishes a real client session from a meeting with a prospective
-- client (lead). Stored per-session (not inferred from the client's
-- current status) so a lead that later converts to a real client doesn't
-- retroactively relabel a past prospective meeting.
-- 'client' (default) or 'prospective'.

ALTER TABLE sessions ADD COLUMN meeting_category TEXT NOT NULL DEFAULT 'client';
