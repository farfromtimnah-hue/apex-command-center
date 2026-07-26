-- Partner referral links (2026-07-26): each gm_partners row gets a unique,
-- unguessable slug that serves a PUBLIC, unauthenticated intake form
-- (referral.html?p=<slug>). Submissions create gm_leads rows with
-- parceiro_id already set — attribution by record, never by text match
-- (the spreadsheet's name join had already drifted: "Mark Alluminum" vs
-- "MARK (LUMINUM)").
--
-- gm_referral_hits is the rate-limit ledger for the public endpoint: one
-- row per submission ATTEMPT (before validation), counted per slug and per
-- IP over a rolling window. Rows older than 2 days are pruned by the
-- Worker on each write.

ALTER TABLE gm_partners ADD COLUMN referral_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmp_slug ON gm_partners (referral_slug);

CREATE TABLE IF NOT EXISTS gm_referral_hits (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gmrh_slug ON gm_referral_hits (slug, created_at);
CREATE INDEX IF NOT EXISTS idx_gmrh_ip ON gm_referral_hits (ip, created_at);
