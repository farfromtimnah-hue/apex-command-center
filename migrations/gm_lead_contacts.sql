-- gm_lead contact log (2026-07-27): the client-facing CRM's own outreach
-- ledger, so the lead sheet can DERIVE follow-up count and first-contacted
-- instead of asking the user to hand-maintain two numbers that the app
-- already knows.
--
-- This is deliberately a SECOND table, not a reuse of lead_contact_log.
-- They look alike and are not interchangeable:
--
--   lead_contact_log.client_id  -> clients(id)   — the APEX-INTERNAL pipeline,
--       where a "lead" is a prospective Apex CLIENT. One row per outreach
--       attempt Apex makes toward winning that client.
--   gm_lead_contacts.lead_id    -> gm_leads(id)  — a CLIENT'S OWN CRM lead.
--       One row per outreach attempt the client makes toward their prospect.
--
-- Joining them would mix Apex's sales funnel with its customers' funnels.
-- client_id is carried alongside lead_id purely so every read can be scoped
-- by the same tenant check the rest of the GM endpoints use, without a join
-- back to gm_leads on every query.
--
-- method/result vocabularies intentionally match LEAD_CONTACT_METHODS and
-- LEAD_CONTACT_RESULTS in the Worker, so both tiers of the product speak the
-- same words and the Apex-side labels can be reused verbatim.

-- gm_leads had no email column at all: only telefone. The lead sheet's new
-- Email button would therefore have been permanently disabled with no way to
-- ever enable it, which is worse than not offering the channel. Added here so
-- the button has a field to read, editable on the sheet like telefone.
ALTER TABLE gm_leads ADD COLUMN email TEXT;

CREATE TABLE IF NOT EXISTS gm_lead_contacts (
  id         TEXT PRIMARY KEY,
  lead_id    TEXT NOT NULL REFERENCES gm_leads(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL,                         -- tenant scope, denormalized
  method     TEXT NOT NULL,                         -- WhatsApp | Phone call | Email | In person | Text message
  result     TEXT,                                  -- No response | Answered | ...
  notes      TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The lead sheet's two derived reads are both "everything for one lead,
-- oldest first" (count, and MIN(logged_at) for first-contacted).
CREATE INDEX IF NOT EXISTS idx_gmlc_lead ON gm_lead_contacts (lead_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_gmlc_client ON gm_lead_contacts (client_id);
