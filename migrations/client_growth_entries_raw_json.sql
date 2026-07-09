-- Growth raw-data input model — persist the numbers Rafa/Alice actually enter
-- (baseline month + revenue line items vs. current month line items) alongside
-- the derived growth_percent, so the input can be reviewed and edited later
-- instead of only the final percentage surviving.
--
-- Stored as one JSON blob per entry because the line items are variable-count
-- and are only ever read back as a unit (to re-open the entry for editing or
-- to show the breakdown). growth_percent stays the sole column the Sales
-- Dashboard queries — nothing there changes. NULL raw_json = a legacy
-- percent-only entry.
--
-- Shape:
-- {
--   "baseline": { "month_label": "2026-04",
--                 "items": [ { "label": "Trabalho 1", "value": 11285 }, ... ] },
--   "current":  { "items": [ { "label": "", "value": 64000 }, ... ] }
-- }
-- (the current month's label is the row's own month_label)

ALTER TABLE client_growth_entries ADD COLUMN raw_json TEXT;
