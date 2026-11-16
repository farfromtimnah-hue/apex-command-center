-- ABC branches, estimate order branch, delivery date or TBD, saved on-site contacts,
-- person names, ABC item descriptions, delivery instructions (2026-11-16).
--
-- ADD-ONLY. NOT applied by the build: Claude reads it, applies it, deploys the Worker.
-- CREATE ... IF NOT EXISTS makes a second run harmless. Every ALTER TABLE ... ADD COLUMN
-- below fails with "duplicate column name" if it is run twice (the same convention as
-- abc_order_drafts.sql): run the file once.
--
-- ORDER: apply it and deploy the Worker in EITHER order. Until every table and column
-- below exists the Worker behaves exactly as before this build (abcBranchColumnsReady
-- is false) and the new routes answer "Not available yet".
--
-- REVIEW THIS: the one-draft-per-contract rule. Before this file it was the partial
-- UNIQUE INDEX idx_gm_abc_drafts_live ON (client_id, contract_id) WHERE status = 'draft'
-- (a separate index, not a table constraint, so it can be dropped). An estimate can now
-- carry lines for two branches, so a contract may need one live draft per ABC account and
-- branch. The index is dropped and made again with the pair added. An older draft has an
-- empty pair ('' and ''); the Worker counts an empty pair as the business's default pair.
-- No table rebuild is needed.

-- 1. The business's ABC accounts and branches. The connection row keeps the DEFAULT pair
--    (every older code path reads it), so is_default = 1 always equals gm_abc_connections.
CREATE TABLE IF NOT EXISTS gm_abc_branches (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  ship_to_number  TEXT NOT NULL,
  branch_number   TEXT NOT NULL,
  ship_to_name    TEXT NOT NULL DEFAULT '',
  branch_name     TEXT NOT NULL DEFAULT '',
  address_text    TEXT NOT NULL DEFAULT '',
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, ship_to_number, branch_number)
);
CREATE INDEX IF NOT EXISTS idx_gm_abc_branches_client ON gm_abc_branches (client_id);
-- At most one default per business.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_abc_branches_default ON gm_abc_branches (client_id) WHERE is_default = 1;

-- 2. Backfill: every existing connection that has both numbers gets one default pair.
INSERT OR IGNORE INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, ship_to_name, branch_name, address_text, is_default, created_by)
SELECT 'bk-' || client_id, client_id, ship_to_number, branch_number, '', '', '', 1, 'backfill'
FROM gm_abc_connections
WHERE ship_to_number IS NOT NULL AND ship_to_number <> '' AND branch_number IS NOT NULL AND branch_number <> '';

-- 3. Saved on-site delivery contacts.
CREATE TABLE IF NOT EXISTS gm_abc_delivery_contacts (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  last_used_at  TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, name, phone)
);
CREATE INDEX IF NOT EXISTS idx_gm_abc_delivery_contacts_client ON gm_abc_delivery_contacts (client_id);

-- 4. New columns on the order drafts. Each fails with "duplicate column name" if run twice.
-- The pair of the draft; empty means the default pair at send time (drafts made before this build).
ALTER TABLE gm_abc_order_drafts ADD COLUMN ship_to_number TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_abc_order_drafts ADD COLUMN branch_number TEXT NOT NULL DEFAULT '';
-- The on-site delivery person (a COPY of a saved person, or typed), never prefilled.
ALTER TABLE gm_abc_order_drafts ADD COLUMN delivery_contact_name TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_abc_order_drafts ADD COLUMN delivery_contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_abc_order_drafts ADD COLUMN delivery_contact_email TEXT NOT NULL DEFAULT '';
-- Free text for the branch, at most 255 characters.
ALTER TABLE gm_abc_order_drafts ADD COLUMN delivery_instructions TEXT NOT NULL DEFAULT '';
-- 1 = the owner chose "TBD, hold the order". Never a default.
ALTER TABLE gm_abc_order_drafts ADD COLUMN delivery_date_tbd INTEGER NOT NULL DEFAULT 0;

-- 5. The pair an estimate line will be ordered from; empty = the estimate's order branch, then the default pair.
-- Each fails with "duplicate column name" if run twice.
ALTER TABLE gm_estimate_items ADD COLUMN abc_ship_to TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_estimate_items ADD COLUMN abc_branch TEXT NOT NULL DEFAULT '';

-- 6. ABC's own item description (what ABC wants in lines[].itemDescription), never Apex's.
-- Each fails with "duplicate column name" if run twice.
ALTER TABLE gm_pricing ADD COLUMN abc_description TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_abc_order_draft_lines ADD COLUMN abc_description TEXT NOT NULL DEFAULT '';
-- 1 = ABC sells this item in lengths (isDimensional). A draft line for it cannot be sent until a length
-- can be chosen (not built yet). Each fails with "duplicate column name" if run twice.
ALTER TABLE gm_pricing ADD COLUMN abc_dimensional INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_abc_order_draft_lines ADD COLUMN abc_dimensional INTEGER NOT NULL DEFAULT 0;

-- 7. One live draft per contract AND pair. Read the note at the top of this file.
DROP INDEX IF EXISTS idx_gm_abc_drafts_live;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_abc_drafts_live_pair
  ON gm_abc_order_drafts (client_id, contract_id, ship_to_number, branch_number) WHERE status = 'draft';
