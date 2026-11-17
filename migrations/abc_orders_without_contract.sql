-- ABC orders without a contract (2026-11-16).
--
-- A materials order draft can now belong to an ACCEPTED ESTIMATE (a small job never gets a
-- contract) or to NO document (a manual "New order" made from the owner's own Price list).
--
-- ADD-ONLY. NOT applied by the build: Claude reads it, applies it, deploys the Worker.
-- Every ALTER TABLE ... ADD COLUMN below FAILS WITH "duplicate column name" if the file is run
-- twice. Run it once. CREATE ... IF NOT EXISTS and DROP INDEX IF EXISTS are harmless to repeat.
--
-- ORDER: apply this file after migrations/abc_branches_and_delivery.sql. Apply it and deploy the
-- Worker in EITHER order. Until both new columns exist the Worker behaves exactly as before
-- (abcNoContractReady is false: no estimate or manual draft is made, the new routes answer Not available yet).
--
-- WHAT TO REVIEW:
--  1. gm_abc_order_drafts.contract_id stays TEXT NOT NULL with no default. A draft with no contract
--     stores the empty string '' (the Worker writes it). No table rebuild is needed or done.
--  2. source_kind: 'contract' (every draft made so far), 'estimate' or 'manual'.
--     estimate_id is already a column (NOT NULL DEFAULT ''); the Worker fills it for estimate drafts.
--  3. manual_key: a random id for a manual order (so many manual orders can exist), '' for the others.
--  4. The one-live-draft rule. The old partial unique index (client, contract, pair) is dropped and
--     remade as ONE live draft per (client, contract, estimate, source kind, pair, manual key).
--     Older rows get source_kind 'contract' and manual_key '' from the column defaults, so their
--     uniqueness is the same as before (their estimate_id is not part of what makes them differ,
--     because contract_id already does). Between the DROP and the CREATE no unique rule exists
--     for a moment: apply the file in one go.

-- Each ALTER fails with "duplicate column name" if run twice.
ALTER TABLE gm_abc_order_drafts ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'contract';
ALTER TABLE gm_abc_order_drafts ADD COLUMN manual_key TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_gm_abc_drafts_live_pair;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_abc_drafts_live_src
  ON gm_abc_order_drafts (client_id, contract_id, estimate_id, source_kind, ship_to_number, branch_number, manual_key) WHERE status = 'draft';
