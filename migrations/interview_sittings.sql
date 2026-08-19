-- One row per interview SITTING, not per client.
--
-- The "Precisa de voce" queue turned into a launcher for a conversational
-- interview (she copies a prompt, talks to her own Claude, the Claude captures
-- the answers to the separate vault DB). This table is how she tells a
-- developer session "I did a sitting" without having to send a text message.
-- She can still text; this is the low-effort path, not a replacement.
--
-- Deliberately ONE signal per sitting rather than one per client: six clicks
-- would repeat the exact mistake -- demanding too much input -- that left the
-- original queue unused for months.
--
-- MEANING OF AN UNRETRIEVED ROW: "she completed a sitting whose answers have
-- not been pulled into Apex yet." It does NOT mean "everything is done."
-- The count of what remains is never stored here -- it stays computed live by
-- the NOT EXISTS query behind the attention endpoint, so writing terms for a
-- client (or correcting them to lead/paused/closed) drops them out of the
-- queue automatically and partial work needs no cleanup by hand.
--
-- The flag clears when retrieved_at is stamped, which a developer session does
-- after writing the collected answers into Apex.
CREATE TABLE IF NOT EXISTS interview_sittings (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'terms',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  created_by_email TEXT,
  note          TEXT,
  retrieved_at  TEXT,
  retrieved_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_interview_sittings_open
  ON interview_sittings (retrieved_at, created_at);
