-- Hero follow-up (2026-09-27), E2: pausing or closing a client turns both of
-- Pr. Rafa's switches OFF and remembers what each was; reactivation restores
-- exactly that. NULL = nothing remembered (active clients, or a switch flipped
-- by hand while paused, whose hand setting then wins). Run ONCE.
ALTER TABLE clients ADD COLUMN daily_log_before_pause INTEGER DEFAULT NULL;
ALTER TABLE clients ADD COLUMN goals_before_pause INTEGER DEFAULT NULL;
