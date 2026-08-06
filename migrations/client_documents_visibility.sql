-- Adds a visibility scope to client_documents so one Documentos section can
-- serve two audiences without a second table.
--
--   'client'  the existing behaviour: the client's own people only.
--   'seller'  visible to the client AND that client's salespeople.
--
-- DEFAULT 'client' is load-bearing, and so is applying this to a table that
-- already holds rows: every document uploaded before this migration was filed
-- under the old client-only contract, and nothing already in a client's
-- Documentos may become visible to a salesperson as a side effect of adding
-- the column. New seller-visible material has to be filed as such deliberately.
ALTER TABLE client_documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'client';

-- The seller Documentos list filters on (client_id, visibility) on every load.
CREATE INDEX IF NOT EXISTS idx_client_documents_visibility
    ON client_documents (client_id, visibility);
