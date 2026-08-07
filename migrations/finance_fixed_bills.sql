-- The bills that arrive every month whether or not anyone thinks about them.
-- Entered ONCE, then never again -- which is the whole bargain: a few minutes
-- of typing buys a forward view that answers "will there be enough to pay Rafa
-- this month, and when is it tight".
--
-- SHIPS EMPTY. No seed rows, no defaults, no examples pre-filled in the form.
-- These are real household and business bills belonging to real people, and
-- the app has no business asserting what someone pays or to whom. Alice types
-- what she wants tracked; anything she does not enter simply is not tracked.
CREATE TABLE IF NOT EXISTS fixed_bills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  -- 1-31. A day past the end of a short month is clamped when the schedule is
  -- generated rather than stored differently, so "the 31st" keeps meaning the
  -- end of the month in February.
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  purpose      TEXT NOT NULL CHECK (purpose IN ('business','personal')),
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_fixed_bills_active ON fixed_bills(active, purpose);
