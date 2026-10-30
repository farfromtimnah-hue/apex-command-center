-- Send with contract (one link), 2026-10-30. The owner's company signature, given
-- when the estimate is sent with the option ticked and applied to the contract
-- when the customer accepts: signer, user, hash of the consent words, IP, device,
-- time. NULL = a normal send (the default). Additive and nullable.
ALTER TABLE gm_estimates ADD COLUMN company_presign_json TEXT DEFAULT NULL;
