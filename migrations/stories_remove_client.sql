-- Remove the two stories drawn from Apex clients' own session transcripts.
--
-- Nicole, 2026-08-31: "it's a little creepy like we were spying on his
-- meetings I realized." A client's session is a private conversation with
-- their consultant, not source material for selling to someone else, and
-- the client never agreed to it being either.
--
-- The public stories stay: those are already published accounts their
-- subjects chose to tell.
DELETE FROM stories WHERE source = 'client';
