-- Contracts fix follow-up F53: Rafa closes a no-contract warning in the
-- meeting. What was decided and an optional note. Additive only.
ALTER TABLE gm_contract_notices ADD COLUMN resolution_decision TEXT;
ALTER TABLE gm_contract_notices ADD COLUMN resolution_note TEXT;
