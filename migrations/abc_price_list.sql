-- ABC Supply price list import (2026-11-05).
--
-- A Price list item can be linked to an ABC Supply item. The contractor's own
-- ABC account cost is then kept as ONE cost line labeled "ABC Supply" in
-- cost_breakdown. The selling price (price) is never touched.
--
-- Money unit: gm_pricing keeps REAL DOLLARS (cost_breakdown amounts and
-- cost_total are dollars), so abc_cost is dollars too, per Price list unit.
--
-- ABC's API terms: these columns hold the contractor's OWN account cost on the
-- contractor's OWN row. Nothing here is shared between clients.
--
-- ADD-ONLY. Run each statement once. An ALTER fails with "duplicate column
-- name" if it is run a second time; that error is harmless.
--
-- ORDER: deploy the Worker FIRST or AFTER, either is safe. Without these
-- columns the new routes answer "not available yet".
--
--   abc_item_number           the ABC item number this row is linked to
--   abc_unit                  ABC's unit of measure code the cost was priced in
--   abc_units_per_apex_unit   how many Price list units one ABC unit covers
--                             (NULL when the units are the same word)
--   abc_cost                  the ABC cost per Price list unit, dollars
--   abc_cost_synced_at        when ABC last answered for this row (UTC)
--   abc_ship_to / abc_branch  the ABC account and branch that priced it
--   abc_apex_unit             the Price list unit the conversion was typed for;
--                             a later change of the unit makes the conversion
--                             stale, so the cost is not refreshed until retyped
ALTER TABLE gm_pricing ADD COLUMN abc_item_number TEXT;
ALTER TABLE gm_pricing ADD COLUMN abc_unit TEXT;
ALTER TABLE gm_pricing ADD COLUMN abc_units_per_apex_unit REAL;
ALTER TABLE gm_pricing ADD COLUMN abc_cost REAL;
ALTER TABLE gm_pricing ADD COLUMN abc_cost_synced_at TEXT;
ALTER TABLE gm_pricing ADD COLUMN abc_ship_to TEXT;
ALTER TABLE gm_pricing ADD COLUMN abc_branch TEXT;
ALTER TABLE gm_pricing ADD COLUMN abc_apex_unit TEXT;

-- One ABC item can be linked to only one Price list row per client.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_pricing_abc_item
  ON gm_pricing (client_id, abc_item_number) WHERE abc_item_number IS NOT NULL;
