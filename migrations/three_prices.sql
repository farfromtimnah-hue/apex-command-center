-- Hero follow-up (2026-09-27), Part H: three prices on every deal.
-- Estimate price = the accepted estimates' sum (computed, never typed).
-- Contract price = what the contract is built from (starts as the estimate
-- price, editable in the builder until the contract is company-signed/sent,
-- frozen once signed). Final total = contract price + every signed change
-- order (= gm_jobs.valor / gm_leads.valor, Part D4d). NULL = not set; existing
-- deals are NOT backfilled. Run ONCE.
ALTER TABLE gm_contracts ADD COLUMN contract_price_cents INTEGER DEFAULT NULL;
ALTER TABLE gm_jobs ADD COLUMN contract_price_cents INTEGER DEFAULT NULL;
ALTER TABLE gm_jobs ADD COLUMN final_total_cents INTEGER DEFAULT NULL;
ALTER TABLE gm_leads ADD COLUMN contract_price_cents INTEGER DEFAULT NULL;
ALTER TABLE gm_leads ADD COLUMN final_total_cents INTEGER DEFAULT NULL;
