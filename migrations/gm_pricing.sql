-- Tabela de precos e custos (2026-08-31): what a client sells, what it costs
-- them to make, and what they charge for it.
--
-- gm_jobs already holds what ONE PROJECT actually cost. This is a different
-- thing: the standing price list for a repeatable item. Nothing held it
-- before, which is why it kept getting rebuilt by hand -- with Delicie the
-- cake was reconstructed from flour at $0.61, sugar at $0.97 and nine eggs
-- at $1.22, which is how it came out that it cost $120 to make and sold at
-- $100. With Produwall the tabela de precos was still a pending task from
-- July.
--
-- cost_breakdown is the point of the table. A cake is not "cost: 120", it is
-- flour + sugar + eggs, and the insight comes from seeing the lines. It is
-- JSON: [{"label": "Farinha", "amount": 0.61}, ...].
--
-- cost_total and margin are DERIVED, never stored. Storing a total that was
-- typed rather than summed is how a breakdown and its total drift apart --
-- the Worker sums cost_breakdown on every read (see gmPricingComputed). The
-- column below exists only as a generated cache for sorting/reporting and is
-- recomputed on every write; readers must use the computed value.
CREATE TABLE IF NOT EXISTS gm_pricing (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  item            TEXT NOT NULL,           -- what they sell. Seeded from gm_config.servicos_json.
  unit            TEXT,                    -- unidade: "un", "kg", "m2", "hora"
  cost_breakdown  TEXT NOT NULL DEFAULT '[]',  -- JSON [{label, amount}] -- the itemisation
  cost_total      REAL,                    -- cache of SUM(cost_breakdown[].amount); recomputed on write
  price           REAL,                    -- what they charge
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT
);

-- Every read is client-scoped and ordered by the manual sort then the name.
CREATE INDEX IF NOT EXISTS idx_gm_pricing_client
  ON gm_pricing (client_id, sort_order, item);

-- CSV import is idempotent on item name within a client: re-importing a
-- spreadsheet updates the matching rows instead of duplicating them. The
-- index is on NOCASE so "Bolo" and "bolo" are the same item, which is what
-- someone re-exporting a spreadsheet means by it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_pricing_client_item
  ON gm_pricing (client_id, item COLLATE NOCASE);
