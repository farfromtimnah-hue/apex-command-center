-- Apex's own referral partners belong to one side: Consulting or Business System.
-- Until now apex_partners had no plan, so both sides showed the same list.
-- Applied ONCE to the remote database (wrangler d1 execute ... --remote --file).
-- Every existing partner reads 'consulting'. The two values are whitelisted in
-- the Worker (CLIENT_PLANS), not by a CHECK here.
--
-- gm_partners (a client's own partners inside the client portal) is a different
-- system and is not touched.
ALTER TABLE apex_partners ADD COLUMN plan TEXT NOT NULL DEFAULT 'consulting';
