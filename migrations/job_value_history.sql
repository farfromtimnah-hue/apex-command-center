-- Hero follow-up (2026-09-27), D4d / F1: every change to a project's value,
-- costs or dates (and to its lead's value and costs) leaves a row here,
-- written in the SAME D1 batch as the UPDATE (INSERT ... SELECT reads the old
-- value first). source: estimate / change_order / contract / manual.
-- source_ref: the document number (EST-0011, CO-0007, CON-0011) or NULL.
-- entity: 'job' (gm_jobs row) or 'lead' (gm_leads row). old_value/new_value
-- carry no declared type so a number stays a number and a date stays text.
-- No backfill: history starts at this deploy. Run ONCE against remote D1.
CREATE TABLE IF NOT EXISTS gm_job_value_history (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    job_id      TEXT,
    lead_id     TEXT,
    entity      TEXT NOT NULL,
    field       TEXT NOT NULL,
    old_value,
    new_value,
    source      TEXT NOT NULL,
    source_ref  TEXT,
    actor       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gm_job_value_history_job ON gm_job_value_history (client_id, job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gm_job_value_history_lead ON gm_job_value_history (client_id, lead_id, created_at);
