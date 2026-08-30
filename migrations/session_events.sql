-- Per-stage history for a session, not just its latest actor.
--
-- The columns added in session_actor_attribution.sql answer "who approved
-- this?" but overwrite on every repeat: a session summarized twice, or
-- approved after a re-edit, keeps only the last actor. Nicole, 2026-08-30:
-- "we need to see the history... so that we knew what I did and what he did
-- and what pastora Alice did. It gives a clearer picture."
--
-- One append-only row per transition. Never updated, never deleted.
CREATE TABLE IF NOT EXISTS session_events (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event      TEXT NOT NULL,   -- 'summarized' | 'approved' | 'discarded' | 'assigned_client' | 'transcript_ingested'
  actor      TEXT,            -- display name, or a system source ('fireflies', 'google_calendar')
  detail     TEXT,            -- optional context, e.g. the client a session was assigned to
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events (session_id, created_at);
