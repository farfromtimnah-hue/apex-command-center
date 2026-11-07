-- Extra material, measured material setup and length by width (2026-11-07).
--
-- ADD-ONLY. Run each statement once. An ALTER fails with "duplicate column
-- name" if it is run a second time; that error is harmless.
--
-- ORDER: deploy the Worker FIRST or AFTER, either is safe. Without these
-- columns the Price list and estimates work exactly as before (the new fields
-- are not read or written until the columns exist).
--
-- gm_pricing:
--   order_extra_percent     extra material, 0 to 100, one decimal. NULL = no extra
--                           material. Never filled in for the owner.
--   order_extra_source      'standard' (copied from the business standard) or
--                           'item' (typed for this item). NULL when empty.
--   measure_kind            area, length, volume, count, or NULL when not set by
--                           hand. A hand choice wins over the unit text.
--   piece_length/width      size of ONE piece, in piece_dim_unit (in or ft)
--   coverage_per_piece      what ONE piece covers, in the item's own unit
--   sold_unit               how the supplier sells it (piece, box, pallet, bundle)
--   coverage_per_sold_unit  what ONE sold unit covers or holds, in the item's unit
--                           (for ABC items the same fact is abc_units_per_apex_unit)
ALTER TABLE gm_pricing ADD COLUMN order_extra_percent REAL;
ALTER TABLE gm_pricing ADD COLUMN order_extra_source TEXT;
ALTER TABLE gm_pricing ADD COLUMN measure_kind TEXT;
ALTER TABLE gm_pricing ADD COLUMN piece_length REAL;
ALTER TABLE gm_pricing ADD COLUMN piece_width REAL;
ALTER TABLE gm_pricing ADD COLUMN piece_dim_unit TEXT;
ALTER TABLE gm_pricing ADD COLUMN coverage_per_piece REAL;
ALTER TABLE gm_pricing ADD COLUMN sold_unit TEXT;
ALTER TABLE gm_pricing ADD COLUMN coverage_per_sold_unit REAL;

-- The business standard for extra material. No row, or NULL, means no standard.
CREATE TABLE IF NOT EXISTS gm_material_settings (
  client_id              TEXT PRIMARY KEY,
  standard_extra_percent REAL,
  updated_by             TEXT,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Length by width on estimate lines: the inputs, for the editor and order
-- drafts only. Length and width in feet, depth in inches.
ALTER TABLE gm_estimate_items ADD COLUMN calc_kind TEXT;
ALTER TABLE gm_estimate_items ADD COLUMN calc_length REAL;
ALTER TABLE gm_estimate_items ADD COLUMN calc_width REAL;
ALTER TABLE gm_estimate_items ADD COLUMN calc_depth REAL;
ALTER TABLE gm_estimate_items ADD COLUMN calc_unit TEXT;
