-- Apex's OWN consulting contract with its clients (Rafa's contract tool,
-- 2026-09-29). Separate from gm_contracts, which is the portal builder for a
-- client's contracts with ITS homeowners. Built from the lead (client.html)
-- and the X-Ray results meeting prep; the client signs on apex-contract.html.
--
-- data_json holds everything the form collected (package, company, owners,
-- dates, schedule, add-ons, bonuses). The clause text is composed from it by
-- the Worker at read time until the company signs; from then on the composed
-- text is frozen in snapshot_json so a later template change never rewrites
-- a signed contract.

CREATE TABLE IF NOT EXISTS apex_contracts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    seq INTEGER NOT NULL UNIQUE,
    number TEXT NOT NULL UNIQUE,
    package_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    data_json TEXT NOT NULL,
    total_cents INTEGER,
    public_token TEXT NOT NULL UNIQUE,
    snapshot_json TEXT,
    content_hash TEXT,
    company_signer_name TEXT,
    company_signed_at TEXT,
    company_signature_kind TEXT,
    company_signature_r2_key TEXT,
    company_signed_by TEXT,
    client_signatures_json TEXT,
    signed_at TEXT,
    sent_at TEXT,
    sent_by TEXT,
    first_viewed_at TEXT,
    last_viewed_at TEXT,
    document_id TEXT,
    terms_applied_at TEXT,
    terms_applied_by TEXT,
    void_reason TEXT,
    voided_at TEXT,
    voided_by TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_apex_contracts_client ON apex_contracts (client_id);

CREATE TABLE IF NOT EXISTS apex_contract_events (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    event TEXT NOT NULL,
    actor TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_apex_contract_events_contract ON apex_contract_events (contract_id);
