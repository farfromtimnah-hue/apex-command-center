-- Scope the categorization layer to the account purpose.
--
-- THE COLLISION THIS FIXES. Alice runs a business account and a personal
-- account through the same dashboard. Categories and rules were global, so:
--
--   HOME DEPOT on the business account  -> Materiais
--   HOME DEPOT on the personal account  -> Casa
--
-- ...could not both be true. The old unique index was (pattern, match_type),
-- one rule per merchant full stop, so categorizing that merchant on one
-- account silently recategorized it on the other. That is WORSE than having no
-- rule at all, because rules apply automatically on arrival: it would be wrong
-- every month, silently, with nothing on screen to prompt a second look.
--
-- WHY NO NEW DATA IS NEEDED FROM HER. A transaction already knows its
-- account_id, and accounts.purpose is already NOT NULL CHECK IN
-- ('business','personal') -- set by which button she clicked when linking. So
-- the scope of any transaction is derivable at match time by joining through
-- to the account. Scope is a property of the RULE, matched against the purpose
-- of the transaction's account.
--
-- SAFE TO RUN NOW, EXPENSIVE LATER. Verified against remote D1 immediately
-- before writing this: categorization_rules 0 rows, transactions 0 rows,
-- accounts 0 rows, categories 13 rows (the starter seed only). Nothing here
-- rewrites real history because there is none yet. Once she has months of
-- categorized transactions, splitting a merchant's history across two scopes
-- becomes a data-migration problem instead of an ALTER.
--
-- 'both' IS THE DEFAULT AND PRESERVES CURRENT BEHAVIOR EXACTLY. A rule scoped
-- 'both' matches transactions on either account, which is what every rule does
-- today. Nothing existing changes meaning.

-- ── categories.scope ─────────────────────────────────────────────────────────
-- Which account's vocabulary this category belongs to. The picker offers only
-- categories matching that transaction's account purpose, plus 'both', so she
-- never scrolls past "Hipoteca" to find "Subcontratados".
ALTER TABLE categories ADD COLUMN scope TEXT NOT NULL DEFAULT 'both'
  CHECK (scope IN ('business','personal','both'));

-- ── categorization_rules: rebuilt for the three-part key ─────────────────────
-- SQLite cannot add a column to a UNIQUE index in place, and cannot alter a
-- CHECK constraint in place either, so the table is rebuilt. Safe ONLY because
-- it is empty (0 rows, verified above) -- there is nothing to copy across.
--
-- Two changes beyond the new column:
--
--   1. The unique key becomes (pattern, match_type, scope). One rule per
--      merchant PER SCOPE. HOME DEPOT can now be Materiais on business and
--      Casa on personal without either overwriting the other.
--
--   2. source gains 'auto'. handlePostFinanceNewTransferConfirm inserts
--      source = 'auto' for "always treat this pair as a transfer", and
--      detectTransfers reads WHERE source = 'auto' -- but the old CHECK
--      allowed only ('manual','llm','seed'), so that INSERT would have thrown
--      at runtime the first time she ticked "sempre". Found while rebuilding
--      the table for scope; fixed here rather than left as a known-broken
--      write path behind a new migration.
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
  -- Which account purpose this rule applies to. A rule written from a
  -- transaction inherits the scope of THAT transaction's account -- not
  -- 'both'. 'both' is reserved for rules she deliberately makes global.
  scope       TEXT NOT NULL DEFAULT 'both'
              CHECK (scope IN ('business','personal','both')),
  category_id TEXT,
  -- manual beats llm beats seed. Her override always wins and is never
  -- silently replaced by a later automatic pass. 'auto' is the transfer
  -- engine's own writer, not a categorization guess.
  source      TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','llm','seed','auto')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

-- One rule per merchant key PER SCOPE. The engine upserts on this:
-- re-categorizing the same merchant on the same account purpose updates the
-- existing rule instead of stacking a second, contradictory one whose winner
-- would depend on row order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_pattern
  ON categorization_rules(pattern, match_type, scope);

-- ── Scope the existing seeds ─────────────────────────────────────────────────
-- The starter set was written entirely in business vocabulary, with a single
-- catch-all "Pessoal" bucket standing in for her whole household. That means
-- every personal expense lands on one line and the spending breakdown tells
-- her nothing about where household money actually goes.
--
-- Income stays 'both': money can arrive on either account, and "Outras
-- Receitas" is as true of a personal deposit as a business one.
UPDATE categories SET scope = 'business'
  WHERE id IN ('cat_materiais','cat_subcontratados','cat_software',
               'cat_marketing','cat_escritorio','cat_impostos');

-- Shared by nature -- she travels, eats and pays bank fees on both accounts,
-- and forcing a side would just make her file the same thing twice.
UPDATE categories SET scope = 'both'
  WHERE id IN ('cat_viagem','cat_refeicoes','cat_taxas','cat_transferencia',
               'cat_receita_clientes','cat_outras_receitas');

-- ── A real personal set ──────────────────────────────────────────────────────
-- Replaces the single "Pessoal" catch-all with the six lines a household
-- budget actually splits along. DELIBERATELY SHORT, for the same reason the
-- business seed is short: every category she has to think about is friction at
-- the exact moment we are asking for her time, and she can add her own. Six
-- lines answer "where did the money go" without turning month one into data
-- entry.
--
-- Unaccented ASCII, matching the existing seeds' style (Escritorio, Refeicoes,
-- Servicos Bancarios) rather than introducing a second convention.
--
-- Idempotent: INSERT OR IGNORE on fixed ids, so re-running never duplicates.
INSERT OR IGNORE INTO categories (id, name_pt, name_en, kind, scope, sort_order, created_at) VALUES
  ('cat_moradia',   'Moradia',   'Housing',   'expense', 'personal', 200, datetime('now')),
  ('cat_mercado',   'Mercado',   'Groceries', 'expense', 'personal', 210, datetime('now')),
  ('cat_saude',     'Saude',     'Health',    'expense', 'personal', 220, datetime('now')),
  ('cat_educacao',  'Educacao',  'Education', 'expense', 'personal', 230, datetime('now')),
  ('cat_lazer',     'Lazer',     'Leisure',   'expense', 'personal', 240, datetime('now')),
  ('cat_seguros',   'Seguros',   'Insurance', 'expense', 'personal', 250, datetime('now'));

-- The old catch-all becomes a personal category rather than being deleted.
-- Deleting it would orphan anything already filed under it; archiving it would
-- hide a bucket she may still want as a genuine "miscellaneous personal". It
-- keeps its id and simply stops being the ONLY personal option.
UPDATE categories SET scope = 'personal', sort_order = 260 WHERE id = 'cat_pessoal';
