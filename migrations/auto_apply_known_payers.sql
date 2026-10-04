-- Auto-apply known payers (2026-10-04).
-- One switch on the single business_settings row. Ships ON (DEFAULT 1): the
-- owners asked for a payer confirmed once to be applied automatically from
-- then on. At 0 the system is suggest-only again, exactly as before.
-- Applied by hand: npx wrangler d1 execute apex-command-center --remote --file migrations/auto_apply_known_payers.sql
ALTER TABLE business_settings ADD COLUMN auto_apply_known_payers INTEGER DEFAULT 1;
