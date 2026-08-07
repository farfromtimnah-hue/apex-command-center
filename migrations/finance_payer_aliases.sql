-- The name on the bank deposit is frequently NOT the client's name. LIRA
-- OUTDOOR LIVING pays from "BRAZILIAN INC"; JM LUXURY POOL wires from "JM
-- WORKS SOLUTIONS". The client signal test in buildMatchCandidates looks for
-- name fragments in the description, so those deposits carry no signal and can
-- never reach the auto tier no matter how many times Alice confirms them.
--
-- This is the tedious-once-then-never-again pattern: she approves the match,
-- the payer key is remembered against that client, and the next deposit from
-- the same payer is recognised without her.
--
-- The key is merchant_normalized, NOT the raw description. That only became a
-- usable key once the Zelle confirmation refs stopped shattering it -- before
-- that fix every deposit produced a unique key and an alias could never match
-- a second time.
CREATE TABLE IF NOT EXISTS client_payer_aliases (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id),
  -- normalizeMerchant() output for the payer, e.g. "ZELLE PAYMENT FROM
  -- BRAZILIAN INC". Unique so one payer can never map to two clients, which
  -- would make matching ambiguous in exactly the way the engine refuses.
  payer_key   TEXT NOT NULL UNIQUE,
  -- How the alias was created: 'approved' when learned from a match Alice
  -- confirmed, 'manual' if she ever enters one directly.
  source      TEXT NOT NULL DEFAULT 'approved'
              CHECK (source IN ('approved','manual')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_payer_aliases_client ON client_payer_aliases(client_id);
