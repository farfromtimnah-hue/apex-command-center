-- Lead audit trail: who did what to a lead, and when.
--
-- THE GAP. gm_leads recorded no author at all — no created_by, no updated_by.
-- On 2026-08-11 four leads moved to Fechado within two minutes (WASHINGTON
-- LEON $145,000, BOBBY E NATALYA $83,000, JEREMY $64,000, CATHI $50,000 —
-- $342,000 together) and the database cannot say who closed them. JM LUXURY
-- POOL alone has five logins: the owner plus four sellers, and sellers move
-- their own leads through stages. "Which seller closed this" is what a
-- commission conversation turns on.
--
-- This is an INCONSISTENCY, not a missing feature. lead_contact_log has
-- logged_by, gm_lead_contacts has logged_by, client_notes has created_by,
-- sessions has created_by/updated_by, and clients has stage_changed_by. The
-- lead row was the exception, and actorName(user) already resolved the
-- identity at every write path — the value was simply dropped.

ALTER TABLE gm_leads ADD COLUMN created_by TEXT;
ALTER TABLE gm_leads ADD COLUMN updated_by TEXT;

-- ⚠️ NOT BACKFILLED, ON PURPOSE. Every existing row keeps created_by NULL.
-- Blank means "not recorded yet", which is TRUE. Writing "Rafa" into 137 rows
-- because he probably did it would put fiction into an audit log, and an audit
-- log that contains guesses is worse than one with gaps — you can no longer
-- tell which entries are evidence.

-- ---------------------------------------------------------------------------
-- The event log.
--
-- ⚠️ NO FOREIGN KEY TO gm_leads, AND THAT IS DELIBERATE.
--
-- The obvious shape is `lead_id TEXT NOT NULL REFERENCES gm_leads(id) ON
-- DELETE CASCADE`, matching gm_lead_files and gm_job_photos. It is wrong here.
-- Cascading would delete a lead's entire history at the exact moment the most
-- important event happens — the deletion itself — so the one question the log
-- exists to answer ("who deleted the $145,000 lead?") is the one question it
-- could never answer.
--
-- So: no FK, no cascade, and events OUTLIVE their lead. A 'deleted' event is
-- written with the lead's name in new_value, because after the row is gone the
-- id resolves to nothing and an orphaned id is not an audit record.
--
-- The cost is orphaned rows accumulating for deleted leads. That is the point,
-- and it is cheap: an event is a few hundred bytes and lead deletion is rare.
--
-- STAGE VALUES ARE LOGGED AS KEYS ('fechado'), never as display strings —
-- an audit log full of raw Portuguese would recreate the exact bug §1 fixed.
-- The UI renders them through the same label table as everything else.
CREATE TABLE IF NOT EXISTS gm_lead_events (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL,
  -- Denormalised so every read scopes by client without a join, and an event
  -- can never be served against the wrong client even if a lead_id is
  -- guessed. Same reasoning as gm_job_photos.client_id.
  client_id   TEXT NOT NULL,
  action      TEXT NOT NULL,   -- 'created' | 'updated' | 'stage_changed' | 'deleted'
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  actor       TEXT,            -- SERVER-SET from actorName(user), never from the body
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gm_lead_events_lead ON gm_lead_events (lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gm_lead_events_client ON gm_lead_events (client_id, created_at);
