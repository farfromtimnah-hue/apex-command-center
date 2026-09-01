-- Custom meeting prep: he assembles an agenda from blocks we already built,
-- and when nothing fits he builds the block himself, mid-meeting, and it
-- works immediately. We clean it up afterwards from what he actually made.

-- One saved agenda. When he chooses "one time" this row is still written --
-- it is what the meeting rendered from, and it is the record of what he
-- needed -- but is_template stays 0 so it never shows in the template list.
CREATE TABLE IF NOT EXISTS prep_agendas (
    id           TEXT PRIMARY KEY,
    client_id    TEXT,
    name         TEXT,
    -- JSON array of block keys, in render order. Built-in blocks are their
    -- render function's key; custom blocks are "custom:<id>".
    blocks       TEXT NOT NULL DEFAULT '[]',
    is_template  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_by   TEXT,
    updated_at   TEXT,
    updated_by   TEXT
);

CREATE INDEX IF NOT EXISTS idx_prep_agendas_client
    ON prep_agendas (client_id);
CREATE INDEX IF NOT EXISTS idx_prep_agendas_template
    ON prep_agendas (is_template);

-- A block he built himself. fields is the Google-Forms-style definition:
-- [{key, label, type, options:[]}] where type is one of
-- text | textarea | choice | multichoice | checkbox | number | yesno.
--
-- This is DELIBERATELY a staging area, not a permanent home. It exists so he
-- is never blocked ten minutes before a meeting; the real version gets built
-- from what is recorded here. built_at marks the ones already rebuilt so the
-- queue only shows what still needs doing.
CREATE TABLE IF NOT EXISTS prep_custom_blocks (
    id           TEXT PRIMARY KEY,
    client_id    TEXT,
    title        TEXT NOT NULL,
    fields       TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_by   TEXT,
    built_at     TEXT,
    built_note   TEXT
);

CREATE INDEX IF NOT EXISTS idx_prep_custom_blocks_open
    ON prep_custom_blocks (built_at);

-- What he actually typed into a custom block, per client. The answers are the
-- point: a field definition tells us the shape he wanted, the answers tell us
-- what the field is really for.
CREATE TABLE IF NOT EXISTS prep_custom_answers (
    id           TEXT PRIMARY KEY,
    block_id     TEXT NOT NULL,
    client_id    TEXT NOT NULL,
    answers      TEXT NOT NULL DEFAULT '{}',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   TEXT,
    UNIQUE (block_id, client_id)
);
