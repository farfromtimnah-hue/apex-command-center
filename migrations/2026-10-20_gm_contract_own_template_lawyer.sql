-- "Meu próprio contrato": has a lawyer reviewed the uploaded contract?
-- 1 = yes, 0 = no, NULL = uploaded before this question existed. Decides whether
-- the site adds a "not reviewed by a lawyer" notice. Additive; applied by hand:
-- npx wrangler d1 execute apex-command-center --remote --file migrations/2026-10-20_gm_contract_own_template_lawyer.sql
ALTER TABLE gm_contract_own_templates ADD COLUMN lawyer_reviewed INTEGER;
