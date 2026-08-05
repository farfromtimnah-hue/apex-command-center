-- gm_config.target_margin: make it NULLABLE, and record who set it (2026-08-05).
--
-- WHY THIS IS A TABLE REBUILD AND NOT TWO ALTERs
--
-- target_margin shipped as `REAL NOT NULL DEFAULT 30`. SQLite cannot drop a
-- NOT NULL constraint or a DEFAULT with ALTER TABLE, so the only way to let the
-- column hold NULL is to rebuild the table. That is the whole reason this file
-- is longer than the two ADD COLUMNs it is really about.
--
-- WHY NULL HAS TO BE POSSIBLE
--
-- All 11 existing rows read target_margin = 30, uniform across every client,
-- and 30 has no source. LIRA's own spreadsheet (CRM GESTÃO - LIRA, OBRAS &
-- MARGEM, row 5) has the MARGEM-ALVO MÍNIMA (%) cell -- the single yellow input
-- annotated "nenhuma proposta sai abaixo deste número" -- EMPTY. It was never
-- filled in, so the sheet's own ALVO? column has nothing to compare against.
-- That spreadsheet is the only material Apex ever received about the growth-
-- management system, so the 30 did not come from the client and did not come
-- from Rafa: it was invented by a build session that needed a number.
--
-- This is the third time this exact defect shipped in this feature.
-- GM_DEFAULT_VENDEDORES put two real LIRA employees onto six unrelated
-- businesses; GM_DEFAULT_CYCLE_MONTHS put a stale seven-month window onto
-- everyone. A margin floor is worse than either, because it is a number a
-- business owner might actually ACT on -- 30% presented as their target reads
-- as advice Apex gave them, and nobody has committed to 30% with anybody.
--
-- An unset floor is honest. A wrong floor is worse than none. New clients
-- therefore get NULL, and every display path renders NULL as "not set" -- never
-- as 0%, never as a passing check, never as a silent skip. A job at 24.9%
-- margin against an unset target is not "on target", it is UNMEASURED.
--
-- THE EXISTING 11 ROWS ARE COPIED VERBATIM AND ARE NOT CLEARED.
--
-- They all carry 30 and nobody knows which (if any) are real. Clearing them
-- would destroy a number a client may have genuinely confirmed; keeping them
-- silently would keep presenting a fabricated floor as fact. So they are
-- preserved as data and disclosed in the UI: because target_margin_set_by is
-- NULL for every one of them, the portal shows "set by default, please
-- confirm" rather than an attribution line. The client confirming their own
-- number is what turns a legacy 30 into a real one.
--
-- ROW COUNT MUST BE 11 IN AND 11 OUT. Verify with COUNT(*) before and after.

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Same shape as the live table, with three deliberate differences:
--   target_margin          REAL NOT NULL DEFAULT 30  ->  REAL (nullable, no default)
--   target_margin_set_by   NEW
--   target_margin_set_at   NEW
-- Every other column, type, NOT NULL and DEFAULT is carried over unchanged so
-- that nothing else about the table's behavior shifts under this migration.
CREATE TABLE gm_config_new (
    client_id                TEXT PRIMARY KEY,
    servicos_json            TEXT NOT NULL DEFAULT '[]',
    vendedores_json          TEXT NOT NULL DEFAULT '[]',
    finance_categories_json  TEXT NOT NULL DEFAULT '[]',
    partner_types_json       TEXT NOT NULL DEFAULT '[]',
    cycle_months_json        TEXT NOT NULL DEFAULT '[]',
    -- NULLABLE, and NO DEFAULT. A new client's floor is unset until a human
    -- sets it. See gmGetConfig() in worker/index.js, which no longer supplies
    -- a value for this column on insert.
    target_margin            REAL,
    -- WHO set the floor and WHEN, following the clients.next_step_set_by
    -- convention: the human's DISPLAY NAME, stamped server-side from the
    -- session, never from the request body. The pair exists so a client
    -- quietly lowering their own floor does not go unnoticed -- the number
    -- became client-editable in this same change, and an editable number with
    -- no author is how a silent edit stays silent.
    --
    -- DELIBERATELY NOT BACKFILLED: the existing 30s have no author, and NULL
    -- here is what makes the UI say "set by default, please confirm" instead
    -- of inventing a name. Same rule as sessions.created_by and
    -- client_logins.created_by.
    target_margin_set_by     TEXT,
    target_margin_set_at     TEXT,
    pipeline_view_threshold  INTEGER NOT NULL DEFAULT 50,
    pipeline_view_override   TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Columns listed explicitly on BOTH sides. A bare INSERT INTO ... SELECT *
-- would bind by position and silently shift every value one column left the
-- moment the two shapes differ -- which they do, by design, right here.
INSERT INTO gm_config_new (
    client_id, servicos_json, vendedores_json, finance_categories_json,
    partner_types_json, cycle_months_json, target_margin,
    target_margin_set_by, target_margin_set_at,
    pipeline_view_threshold, pipeline_view_override, created_at, updated_at
)
SELECT
    client_id, servicos_json, vendedores_json, finance_categories_json,
    partner_types_json, cycle_months_json,
    target_margin,   -- carried over verbatim; the 11 legacy 30s survive intact
    NULL,            -- target_margin_set_by  — no author exists for a legacy 30
    NULL,            -- target_margin_set_at  — and no date either
    pipeline_view_threshold, pipeline_view_override, created_at, updated_at
FROM gm_config;

DROP TABLE gm_config;

ALTER TABLE gm_config_new RENAME TO gm_config;

COMMIT;

PRAGMA foreign_keys = ON;
