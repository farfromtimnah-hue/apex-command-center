-- Transactions Alice ruled OUT of an Apex Club event.
--
-- The suggester recomputes candidates from scratch on every page load -- a $50
-- or $75 credit in the window, or a memo hit -- so before this table there was
-- no way to say no. A payment that merely LOOKED like a dinner ticket came
-- back as a suggestion forever, and the only button on the row was "Belongs
-- here". Saying no had to be a stored fact or it could not survive a refresh.
--
-- Scoped to the EVENT, deliberately. Saying "this is not the July dinner" is
-- not the same as saying "this is never Apex Club", and the narrow claim is
-- the one Alice can actually make from what is on her screen. Windows are 21
-- days against a roughly monthly event, so overlap is rare -- and where it
-- does overlap, being asked once more about the neighbouring event is a much
-- cheaper mistake than a payment going permanently quiet.
--
-- The transaction itself is untouched. It stays uncategorized and keeps
-- showing up under Categorias, which is the point: it is not Apex Club, it is
-- something else, and it still needs filing somewhere. Dismissing hides it
-- from ONE suggestion list, nothing more.
--
-- Undo is a row delete, same as un-confirming. No history worth auditing.
CREATE TABLE IF NOT EXISTS apex_club_event_dismissed (
  event_id       TEXT NOT NULL REFERENCES apex_club_events(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  dismissed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_by   TEXT,
  PRIMARY KEY (event_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_club_dismissed_event ON apex_club_event_dismissed(event_id);
