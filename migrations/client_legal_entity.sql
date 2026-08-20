-- Legal-entity identifiers for a client, kept BACKEND-ONLY.
--
-- Why this exists, concretely: registering a business to send application-to-person
-- SMS (10DLC, the carrier registration every US CRM texting feature requires) asks
-- for the exact registered legal name, the state document number, the EIN, and the
-- registered address -- and it rejects a submission where those do not match the
-- state record character for character. That paperwork is why CRM auto-texts were
-- shelved. Recording the answers as they surface costs nothing now and removes the
-- worst part of the work if it is ever picked back up.
--
-- It is also the answer to a subtler problem already seen twice: the name a client
-- TRADES under is frequently not the name on their bank payments or on the state
-- register. JM Luxury Pools pays as JM WORKS SOLUTIONS BUSINESS LLC and is not
-- findable in the Sunbiz entity index at all -- it exists only as a fictitious name
-- in a separate system. Someone searching the trading name finds nothing and
-- reasonably concludes the company is not registered.
--
-- NOT shown in the client-facing UI. Rafa's Claude reads D1 directly, so storing it
-- here is what puts it in front of him when he asks -- no screen required.

ALTER TABLE clients ADD COLUMN legal_entity_name TEXT;
ALTER TABLE clients ADD COLUMN legal_entity_ein TEXT;
ALTER TABLE clients ADD COLUMN legal_entity_address TEXT;
ALTER TABLE clients ADD COLUMN legal_entity_filed_at TEXT;
ALTER TABLE clients ADD COLUMN legal_entity_status TEXT;
ALTER TABLE clients ADD COLUMN legal_entity_officers TEXT;   -- JSON array: [{name, title}]
ALTER TABLE clients ADD COLUMN legal_entity_dba TEXT;        -- the fictitious name, if the trading name is one
ALTER TABLE clients ADD COLUMN legal_entity_dba_number TEXT;
ALTER TABLE clients ADD COLUMN duns_number TEXT;
-- Provenance. A legal identifier with no source is a claim, not a record: it must
-- be re-verifiable later, and "where did this come from" is the first question
-- anyone filling out carrier paperwork will ask.
ALTER TABLE clients ADD COLUMN legal_entity_source TEXT;
ALTER TABLE clients ADD COLUMN legal_entity_verified_at TEXT;
