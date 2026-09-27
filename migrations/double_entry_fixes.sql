-- Hero follow-up (2026-09-27), Part G (double-entry audit fixes). Run ONCE.
-- G2f: property county and type are stored with the lead's address the first
-- time a contract answers them, and prefill every later contract.
ALTER TABLE gm_leads ADD COLUMN property_county TEXT DEFAULT NULL;
ALTER TABLE gm_leads ADD COLUMN property_type TEXT DEFAULT NULL;
-- G6b: the project keeps the job name (the estimate's job_name) apart from
-- the customer's name (obra keeps holding the customer, as it always has).
ALTER TABLE gm_jobs ADD COLUMN job_name TEXT DEFAULT NULL;
-- G5d: a verified invoice payment posts to Financeiro as income, a reversal
-- posts the matching reversal; each Financeiro row names the payment and the
-- kind, and the pair is UNIQUE, so the same payment can never post twice.
ALTER TABLE gm_finance ADD COLUMN invoice_payment_id TEXT DEFAULT NULL;
ALTER TABLE gm_finance ADD COLUMN auto_kind TEXT DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_gmf_invoice_payment ON gm_finance (invoice_payment_id, auto_kind) WHERE invoice_payment_id IS NOT NULL;
