-- A meeting can be about more than one company.
--
-- Marcelo Diniz owns GATOR OUTDOOR LIVING and MY PURE FILTER, and Rafa holds a
-- single weekly block covering both. sessions.client_id can only name one, so
-- that meeting was filed under neither and the Meeting Prep link could not open
-- for it at all.
--
-- Notes and transcripts stay on the session row and are SHOWN from both client
-- profiles rather than copied. The meetings genuinely cannot be unmixed, so two
-- copies would only diverge with nothing to say which one is true.
--
-- sessions.client_id is left in place as the primary link. Every existing read
-- path keeps working; this table is additive.
CREATE TABLE IF NOT EXISTS session_clients (
    session_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,

    -- 1 for the client that also sits in sessions.client_id, so the primary
    -- survives a rebuild of this table from scratch.
    is_primary  INTEGER NOT NULL DEFAULT 0,

    -- How the link was made: 'manual' | 'importer' | 'voice' | 'backfill'.
    -- Kept so a bad matcher run can be undone without touching hand-made links.
    source      TEXT,

    -- Room for a per-client note on a shared meeting, if that need ever appears.
    -- Shared truth on the session, optional per-client layer here.
    note        TEXT,

    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    created_by  TEXT,

    PRIMARY KEY (session_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_session_clients_client ON session_clients (client_id);
CREATE INDEX IF NOT EXISTS idx_session_clients_session ON session_clients (session_id);
