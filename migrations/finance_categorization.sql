-- Categorization layer for finance-new.html.
--
-- `categories` and `categorization_rules` already existed as empty scaffolding
-- from the first finance-new build, where categorization was scoped as
-- "optional enrichment" and never reached. Both are still empty (0 rows), so
-- these ALTERs are safe and no backfill is required.
--
-- What was missing for a working rules engine:
--
--   1. A typed match key. `categorization_rules.pattern` is untyped text; the
--      engine matches on transactions.merchant_normalized specifically, and a
--      rule keyed on anything else would silently never fire. match_type names
--      what the pattern IS so a future contains/regex rule cannot be confused
--      for an exact merchant key.
--
--   2. A three-way source. The old CHECK allowed only manual/auto, but the
--      engine has three distinct writers and they do NOT rank equally: her
--      manual rule must beat an LLM guess, and an LLM guess must beat nothing.
--      SQLite cannot alter a CHECK constraint in place, so the rules table is
--      rebuilt below rather than ALTERed.
--
--   3. Provenance on the transaction. Knowing a category came from an LLM
--      guess rather than from her is what lets the UI stay honest about which
--      numbers she has actually confirmed.

-- ── categories: display order and an archived flag ───────────────────────────
-- sort_order keeps the seeded starter set in a deliberate order rather than
-- whatever order rows happen to come back in. archived lets her retire a
-- category without orphaning the historical transactions filed under it --
-- deleting one would silently rewrite past months.
ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE categories ADD COLUMN archived   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE categories ADD COLUMN created_at TEXT;

-- ── transactions: how the category got there ─────────────────────────────────
-- 'rule'   — a string rule matched on arrival (free, deterministic)
-- 'llm'    — the LLM classified this merchant once; a rule was persisted
-- 'manual' — she chose it herself; never overwritten by any automatic layer
ALTER TABLE transactions ADD COLUMN category_source TEXT;
ALTER TABLE transactions ADD COLUMN categorized_at  TEXT;

CREATE INDEX IF NOT EXISTS idx_txn_category    ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_merchant    ON transactions(merchant_normalized);

-- ── categorization_rules: rebuilt for the typed key + three-way source ───────
-- Safe as a drop/recreate ONLY because the table is empty. Verified 0 rows
-- against remote D1 before writing this migration.
DROP TABLE IF EXISTS categorization_rules;

CREATE TABLE categorization_rules (
  id          TEXT PRIMARY KEY,
  -- The normalized merchant key this rule fires on, e.g. "HOME DEPOT".
  -- Raw BofA descriptions vary ("HOME DEPOT #6217 TAMPA FL" vs
  -- "HOME DEPOT #0412"), so matching happens on merchant_normalized, which is
  -- computed at sync time by normalizeMerchant().
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL DEFAULT 'merchant_exact'
              CHECK (match_type IN ('merchant_exact','merchant_contains')),
  category_id TEXT,
  -- manual beats llm beats seed. Her override always wins and is never
  -- silently replaced by a later automatic pass.
  source      TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','llm','seed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

-- One rule per merchant key. The engine upserts on this: re-categorizing the
-- same merchant updates the existing rule instead of stacking a second,
-- contradictory one whose winner would depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_pattern ON categorization_rules(pattern, match_type);
