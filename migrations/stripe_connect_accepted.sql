-- 2026-10-04: records when the owner ticked that Apex reads Stripe payment history.
ALTER TABLE gm_stripe_accounts ADD COLUMN accepted_at TEXT;
