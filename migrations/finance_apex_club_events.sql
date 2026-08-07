-- Apex Club is a dinner with a guest speaker, roughly monthly: $50 per person,
-- $75 per couple, with food and books paid out by Zelle.
--
-- Scoped to the EVENT, not the month. Two dinners can fall in one month and a
-- month-shaped P&L would fuse them into one number that answers nothing; the
-- question is "did the July dinner make money", not "what did July cost".
-- Income also arrives across a window (attendees pay from a week before to a
-- few days after), so the window is stored per event rather than assumed.
--
-- Rafa launches first and thinks later and Alice is the grounding, so early
-- over-investment is expected and fine -- but it has to be VISIBLE. This
-- table exists so the answer is "made money / lost a little / lost a lot"
-- rather than a feeling.
CREATE TABLE IF NOT EXISTS apex_club_events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  event_date   TEXT NOT NULL,
  -- The window transactions are drawn from. Defaults are applied in the
  -- worker, not here, so widening one event never rewrites another.
  window_start TEXT NOT NULL,
  window_end   TEXT NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
);

-- Which transactions Alice CONFIRMED belong to an event.
--
-- The engine only ever suggests: it can see a $50 Zelle in the window from a
-- payer who is not a client, but it cannot know whether that person came to
-- dinner. Only confirmed rows count toward the P&L, so a wrong guess never
-- silently moves the number she is trying to trust. Removing a confirmation
-- is a row delete, not a flag, because an event membership carries no history
-- worth auditing -- the transaction itself is untouched either way.
CREATE TABLE IF NOT EXISTS apex_club_event_txns (
  event_id       TEXT NOT NULL REFERENCES apex_club_events(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  -- 'income' = an attendee paying, 'expense' = food, books, venue.
  side           TEXT NOT NULL CHECK (side IN ('income','expense')),
  -- How many people this payment covers: 1 at $50, 2 at $75. Suggested from
  -- the amount, always confirmable, and used for the headcount rather than
  -- inferring it from the money a second time.
  people         INTEGER NOT NULL DEFAULT 1,
  confirmed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_by   TEXT,
  PRIMARY KEY (event_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_club_txns_event ON apex_club_event_txns(event_id);
