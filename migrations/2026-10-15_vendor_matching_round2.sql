-- Fornecedores round 2: date-aware matching, "I sent the payment" declarations,
-- a real reviewed-match ledger, and Alice's question box. Additive only --
-- no existing table or row is touched.

ALTER TABLE vendor_services ADD COLUMN starts_on TEXT;

-- Backfill existing rows from the client's own stored package start date
-- (clients.package_started_at) -- NEVER a guess. Only rows whose client
-- actually has that column filled in are touched; everything else stays
-- NULL (the date rule then does not apply to it). See the session report
-- for which rows this reached and which were left NULL.
UPDATE vendor_services
SET starts_on = (SELECT c.package_started_at FROM clients c WHERE c.id = vendor_services.client_id)
WHERE starts_on IS NULL
  AND EXISTS (SELECT 1 FROM clients c WHERE c.id = vendor_services.client_id AND c.package_started_at IS NOT NULL);

-- A "historical, per Alice" paid entry (question-box effects) has no
-- payment batch -- this is where that note lives instead.
ALTER TABLE vendor_payables ADD COLUMN note TEXT;

ALTER TABLE vendor_payment_batches ADD COLUMN kind TEXT DEFAULT 'bank' CHECK (kind IN ('bank','sent') OR kind IS NULL);
ALTER TABLE vendor_payment_batches ADD COLUMN sent_on TEXT;
ALTER TABLE vendor_payment_batches ADD COLUMN expected_cents INTEGER;

-- A transaction a person has confirmed, moved, or undone. The automatic
-- matcher (vendorAutoMatch) excludes every transaction_id in here, forever --
-- see vendorUnmatchedRemitlyRaw.
CREATE TABLE IF NOT EXISTS vendor_match_reviews (
  transaction_id TEXT PRIMARY KEY,
  reviewed_by TEXT,
  reviewed_at TEXT,
  kind TEXT
);

-- Alice's open questions, asked once each through the question box on
-- vendors.html. status flips to 'answered' once her reply is interpreted
-- and applied (or recorded, for older_clients_no_vendors).
CREATE TABLE IF NOT EXISTS vendor_questions (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  text_pt TEXT,
  text_en TEXT,
  status TEXT DEFAULT 'open',
  answer_raw TEXT,
  interpreted_json TEXT,
  answered_by TEXT,
  answered_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One row per Claude call from the question box, for the "at most 5 per
-- minute per user" rate limit (handleGetVendorQuestionAnswer). Nothing else
-- reads this table.
CREATE TABLE IF NOT EXISTS vendor_question_claude_calls (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_question_claude_calls_user ON vendor_question_claude_calls (user_email, created_at);

INSERT OR IGNORE INTO vendor_questions (id, key, text_pt, text_en, status, created_at) VALUES
  ('vq-dipro-first-month', 'dipro_first_month',
   'Dipro Remodeling: o primeiro pagamento de redes sociais para a Rais foi de qual mês? (Outubro está pausado e volta em novembro.)',
   'Dipro Remodeling: which month was the first Rais social media payment for? (October is paused and resumes in November.)',
   'open', datetime('now')),
  ('vq-golden-site-halves', 'golden_site_halves',
   'Golden Home Improvement: as duas metades do site já foram pagas, ou ainda falta a segunda metade?',
   'Golden Home Improvement: are both halves of the site paid, or is the second half still owed?',
   'open', datetime('now')),
  ('vq-older-clients-no-vendors', 'older_clients_no_vendors',
   'JKD Flooring, General Tile, JM Luxury Pools e Lira Outdoor Living: confirma que nenhum deles tem serviços de fornecedor?',
   'JKD Flooring, General Tile, JM Luxury Pools and Lira Outdoor Living: do you confirm none of them has vendor services?',
   'open', datetime('now'));
