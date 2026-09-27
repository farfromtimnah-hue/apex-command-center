-- Docs PDF build, Part A: final customer documents are rendered ONCE by
-- Browser Rendering and the bytes stored in R2. Every later download serves
-- these same bytes. One row per document; the UNIQUE key is the guard when
-- two requests race to store the first render (INSERT OR IGNORE, the loser
-- serves the winner's row). Additive only.
CREATE TABLE IF NOT EXISTS gm_document_pdfs (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    doc_kind      TEXT NOT NULL,
    doc_id        TEXT NOT NULL,
    doc_number    TEXT,
    source_status TEXT,
    r2_key        TEXT NOT NULL,
    sha256        TEXT NOT NULL,
    byte_size     INTEGER,
    page_count    INTEGER,
    render_ms     INTEGER,
    rendered_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (doc_kind, doc_id)
);
