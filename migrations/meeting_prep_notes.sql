-- Notes Rafa types DURING a meeting, per client per meeting type.
--
-- The X-Ray meeting opens with him asking the prospect to name their own
-- bottleneck BEFORE he shows any score -- "me fala um pouquinho, o que você
-- mais percebe aqui de gargalo" -- because hearing them say it first is what
-- keeps the diagnosis from landing as an accusation. Until now that answer
-- lived only in his memory for the rest of the call.
--
-- Stored per (client, meeting_type) rather than per session: the prep page is
-- opened before a session row necessarily exists, and for a PROSPECT there may
-- be no session at all. Upserted, so reopening the page keeps what he typed.
CREATE TABLE IF NOT EXISTS meeting_prep_notes (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  meeting_type TEXT NOT NULL,          -- 'xray_results' | 'kickoff' | 'weekly_rde' | 'cycle_close'
  bottleneck   TEXT,                   -- free text, his bullets, in their words
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   TEXT,
  UNIQUE (client_id, meeting_type)
);
