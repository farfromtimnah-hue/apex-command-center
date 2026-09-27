-- Contracts fix build, checkpoint B. Additive only.
-- F41: where a client-private clause option came from. Only a full client
-- template loaded by Apex ('apex_template') unlocks "Meu proprio contrato"; an
-- approved custom clause ('custom_clause') does not. Existing rows stay NULL
-- (neither), so nothing unlocks until Apex loads a template.
ALTER TABLE contract_clause_options ADD COLUMN origin TEXT;
-- A signed change order adjusted an invoice the homeowner already received:
-- flagged until the invoice is sent again.
ALTER TABLE gm_invoices ADD COLUMN changed_after_send_at TEXT;
