-- Whether the client can see a given document AT ALL.
--
-- This is a SECOND, separate column, not a widening of `visibility`. The two
-- answer different questions and must not be conflated:
--
--   visibility     which SECTION a document is filed in — 'client' (the
--                  client's own files) or 'seller' (material for that client's
--                  sales team). BOTH values are visible to the client.
--   client_visible whether the client sees the document at all.
--
-- A draft Rafa is still working on has to be hidden from the client AND
-- from their sellers. No value of `visibility` can express that — every value
-- of it is client-visible by definition — so overloading, renaming or
-- repurposing that column would destroy the section meaning to buy a flag.
--
-- DEFAULT 1 is load-bearing, for the same reason DEFAULT 'client' was in
-- client_documents_visibility.sql — but pointing the other way. There, the
-- risk was a migration silently WIDENING who could see an existing row, so the
-- default was the narrow value. Here the risk is the mirror image: all 30 rows
-- in this table are visible to their clients today, and adding a column must
-- not silently HIDE a document a client can currently see. So the column
-- default is the permissive value, 1.
--
-- The 0 default for Claude-sourced documents is therefore NOT expressed here.
-- It is enforced at the write path (the receiving endpoint sets the flag
-- server-side), because it is a property of how the document ARRIVED, not a
-- property of the column. A UI upload is someone deliberately putting a file on
-- a client's profile, so it lands visible; a document pushed in from Rafa's
-- Claude is a draft until he says otherwise, so it lands hidden. The safe case
-- does not depend on anyone remembering to flip a switch.
ALTER TABLE client_documents ADD COLUMN client_visible INTEGER NOT NULL DEFAULT 1;

-- The client's document list filters on (client_id, client_visible) on every
-- load, in both sections.
CREATE INDEX IF NOT EXISTS idx_client_documents_client_visible
    ON client_documents (client_id, client_visible);
