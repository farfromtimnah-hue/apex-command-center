-- Who did what to a session.
--
-- Before this, sessions recorded approved_at but never WHO approved. The
-- ladder is inbox -> pending -> summarized -> approved, and each step is a
-- different person's judgment: summarize runs Claude over the transcript,
-- approve is the human sign-off after reading and editing it. Attributing
-- only the timestamp made a July 2026 backlog cleanup indistinguishable from
-- Rafa's normal weekly review.
--
-- Not backfillable: the actor was never captured for existing rows, so every
-- row before 2026-08-30 stays NULL rather than being guessed at.
ALTER TABLE sessions ADD COLUMN summarized_by TEXT;
ALTER TABLE sessions ADD COLUMN summarized_at TEXT;
ALTER TABLE sessions ADD COLUMN approved_by   TEXT;
ALTER TABLE sessions ADD COLUMN discarded_by  TEXT;
ALTER TABLE sessions ADD COLUMN discarded_at  TEXT;
