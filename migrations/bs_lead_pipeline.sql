-- Business System lead pipeline (Lead, Contato inicial, Lista de espera, Link enviado).
-- Applied ONCE to the remote database (wrangler d1 execute ... --remote --file).
-- All new columns stay NULL for every existing row and the new table starts empty.
--
--   bs_waitlist_at   when a business_system lead ENTERED the stage Lista de espera
--                    (people are contacted oldest first)
--   bs_link_sent_at  when it entered the stage Link enviado
--   bs_activated_at  when bsActivateLead made it an active client
--
-- bs_lead_links holds the sign-up links a later build will send. Only the sha256
-- HASH of the token is stored; the raw token is shown to its caller once.
ALTER TABLE clients ADD COLUMN bs_waitlist_at TEXT;
ALTER TABLE clients ADD COLUMN bs_link_sent_at TEXT;
ALTER TABLE clients ADD COLUMN bs_activated_at TEXT;

CREATE TABLE IF NOT EXISTS bs_lead_links (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  sent_at      TEXT,
  opened_at    TEXT,
  activated_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bs_lead_links_client ON bs_lead_links (client_id);
