-- Engagement duration and engagement start.
--
-- WHY: three client series on Rafa's Google Calendar are weekly with NO end --
-- no COUNT, no UNTIL -- confirmed by reading Google's own recurrence rule for
-- each master event. The likely cause is that the booking dialog asked
-- "Numero de reunioes" (how many meetings?), which requires converting a
-- package length and a start date into a week count in your head, while
-- booking. Alice had no way to know how many weeks an engagement runs, so she
-- set them to repeat forever.
--
-- Fixing that means the app needs two facts it never recorded: how long a
-- package runs, and when this client's engagement actually began.

-- ---------------------------------------------------------------------------
-- 1. Package duration.
--
-- `packages` carries prices but no duration at all. Seeded from the real
-- lineup in the vault (apex-consulting.md). Deliberately NULL where the vault
-- does not state a duration -- a guessed number here silently produces a wrong
-- end date on a real client engagement.
--
--   Business Growth       -- not stated in the vault
--   Executive Leadership  -- runs alongside other packages, not a fixed term
--   Raio-X                -- a diagnostic, not a term engagement
--   Premium (legacy)      -- maps to nothing in the known old lineup
--
-- Legacy values still live in D1: METZ is on `Sprint`, JM LUXURY POOL on
-- `Premium`. The old lineup was Start = 30 days, Sprint = 3 months, Elite
-- Construction = 6 months, so `Sprint` is safely 90 -- `Premium` is not.
-- ---------------------------------------------------------------------------
ALTER TABLE packages ADD COLUMN duration_days INTEGER;

UPDATE packages SET duration_days = 30  WHERE id = 'pkg_start';
UPDATE packages SET duration_days = 90  WHERE id = 'pkg_sprint';
UPDATE packages SET duration_days = 180 WHERE id = 'pkg_advanced';
-- pkg_growth, pkg_executivo, pkg_raio_x, pkg_premium stay NULL on purpose.

-- ---------------------------------------------------------------------------
-- 2. Engagement start.
--
-- NOTE: clients.package_started_at was already added to production by hand on
-- 2026-08-03 and is populated for DELICIE CAKES (2026-08-03), the only
-- lead->client conversion that has ever gone through the current system. The
-- statement below is here so a rebuilt database matches production; it is a
-- no-op against production itself and D1 will report a duplicate-column error
-- if re-run there. Every other client is NULL deliberately -- NOT backfilled,
-- NOT guessed.
--
-- Why MIN(date) from sessions is not good enough: a lead meets Rafa BEFORE
-- becoming a client. That sales/diagnostic meeting does not count toward the
-- package, because the package did not exist yet -- so first-session-on-file
-- starts the clock too early on any converted lead. meeting_category does not
-- help either: every historical row is 'client', including whatever the first
-- meeting actually was.
--
-- For legacy clients the recurrence dialog shows "first session on file",
-- labelled honestly as such, and Alice uses the Custom duration option.
-- ---------------------------------------------------------------------------
-- ALTER TABLE clients ADD COLUMN package_started_at TEXT;   -- already applied in production
