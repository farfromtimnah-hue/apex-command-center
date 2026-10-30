-- Business System (2026-10-30). ADDITIVE ONLY: five new columns on clients, two
-- new tables, one index. No existing row is rewritten: every client reads
-- plan 'consulting' and split_mode 'split_50_50' from the column defaults.
--
-- plan: 'consulting' (Pr Rafa's original business, weekly meetings plus the
--   portal) or 'business_system' (pays monthly for the portal tools only).
--   Leads are rows in this same table (status 'lead'), so one label covers
--   clients and leads.
-- split_mode: how a Business System client's monthly amount is shared.
-- monthly_amount_cents: NULL until staff enters it. There is NO default price.
--
-- Apply ONCE to the remote database (D1 write limits are account-wide):
--   CLOUDFLARE_ACCOUNT_ID=b52dcd8983e33e42355f98649193e20c \
--   npx wrangler d1 execute apex-command-center --remote --file migrations/clients_plan_and_split.sql

ALTER TABLE clients ADD COLUMN plan TEXT NOT NULL DEFAULT 'consulting' CHECK (plan IN ('consulting','business_system'));
ALTER TABLE clients ADD COLUMN plan_changed_at TEXT;
ALTER TABLE clients ADD COLUMN plan_changed_by TEXT;
ALTER TABLE clients ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'split_50_50' CHECK (split_mode IN ('split_50_50','resonate_100','rafa_100'));
ALTER TABLE clients ADD COLUMN monthly_amount_cents INTEGER CHECK (monthly_amount_cents IS NULL OR monthly_amount_cents >= 0);

CREATE INDEX IF NOT EXISTS idx_clients_plan ON clients (plan);

-- The Business System costs ledger. Money is integer cents. Dates are ISO text
-- (YYYY-MM-DD). Soft delete only (deleted_at). Seeded with NO rows.
CREATE TABLE IF NOT EXISTS bs_cost_entries (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('investment','recurring_cost','planned_cost','income')),
  description  TEXT NOT NULL,
  category     TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  frequency    TEXT NOT NULL CHECK (frequency IN ('one_time','monthly','yearly')),
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  paid_by      TEXT CHECK (paid_by IS NULL OR paid_by IN ('resonate','rafa','joint')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT,
  updated_at   TEXT,
  updated_by   TEXT,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bs_cost_entries_kind ON bs_cost_entries (kind, deleted_at);

-- Promo materials page: one row per language. The pt row names the Aprenda
-- promo; its video_url is filled after the video is uploaded to the private
-- media bucket (not in this file: the mp4 is never committed). The en row is
-- empty on purpose. No post wording is invented here.
CREATE TABLE IF NOT EXISTS bs_promo_items (
  id         TEXT PRIMARY KEY,
  lang       TEXT NOT NULL UNIQUE CHECK (lang IN ('pt','en')),
  title      TEXT NOT NULL DEFAULT '',
  video_url  TEXT NOT NULL DEFAULT '',
  poster_url TEXT NOT NULL DEFAULT '',
  post_text  TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  updated_by TEXT
);
INSERT OR IGNORE INTO bs_promo_items (id, lang, title, video_url, poster_url, post_text) VALUES ('bs-promo-pt', 'pt', 'Aprenda (promo)', '', '', '');
INSERT OR IGNORE INTO bs_promo_items (id, lang, title, video_url, poster_url, post_text) VALUES ('bs-promo-en', 'en', '', '', '', '');
