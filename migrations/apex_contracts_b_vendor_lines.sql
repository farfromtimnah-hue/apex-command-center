-- Vendor services sold inside an Apex contract (Nicole, 2026-09-29): what
-- Pra. Alice has to send to Brazil. One row per service per contract, so a
-- client can carry several add-ons from the same vendor (client_vendor_terms
-- allows one active row per client+vendor and adds its amount to invoices;
-- these are ALREADY inside the contract price, so they must never be billed
-- again). Written when the client finishes signing; turned off if the
-- contract is voided. Read by the Fornecedores page tally.
--
-- source: 'addon'    = an extra service added to the package in the builder
--         'included' = a vendor service inside the package price (ADVANCED:
--                      social media US$ 220/month, site US$ 300 once)
-- Accounting is never here: those clients are referred and pay the
-- accountant directly.

CREATE TABLE IF NOT EXISTS apex_contract_vendor_lines (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    recurrence TEXT NOT NULL,
    months INTEGER NOT NULL DEFAULT 1,
    vendor_cost_cents INTEGER,
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_acvl_vendor ON apex_contract_vendor_lines (vendor_id, active);
CREATE INDEX IF NOT EXISTS idx_acvl_contract ON apex_contract_vendor_lines (contract_id);
