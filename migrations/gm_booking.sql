-- Online booking for a client business: a public page where a lead (or anyone
-- with the general link) picks a day and time and answers a few questions.
-- OFF for every business until its owner switches it on. Only adds tables.

CREATE TABLE IF NOT EXISTS gm_booking_settings (
    client_id        TEXT PRIMARY KEY,
    enabled          INTEGER NOT NULL DEFAULT 0,
    public_slug      TEXT UNIQUE,
    work_days        TEXT NOT NULL DEFAULT '1,2,3,4,5',
    day_start        TEXT NOT NULL DEFAULT '09:00',
    day_end          TEXT NOT NULL DEFAULT '17:00',
    duration_min     INTEGER NOT NULL DEFAULT 60,
    min_notice_hours INTEGER NOT NULL DEFAULT 24,
    daily_cap        INTEGER NOT NULL DEFAULT 4,
    window_days      INTEGER NOT NULL DEFAULT 14,
    event_type       TEXT,
    questions_json   TEXT,
    updated_by       TEXT,
    updated_at       TEXT
);

CREATE TABLE IF NOT EXISTS gm_booking_requests (
    id               TEXT PRIMARY KEY,
    token            TEXT NOT NULL UNIQUE,
    client_id        TEXT NOT NULL,
    lead_id          TEXT,
    kind             TEXT NOT NULL DEFAULT 'lead' CHECK (kind IN ('lead','general')),
    status           TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','booked','cancelled','expired')),
    answers_json     TEXT,
    slot_date        TEXT,
    slot_time        TEXT,
    end_time         TEXT,
    event_id         TEXT,
    customer_name    TEXT,
    customer_phone   TEXT,
    customer_email   TEXT,
    customer_address TEXT,
    customer_city    TEXT,
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at          TEXT,
    booked_at        TEXT,
    cancelled_at     TEXT
);

-- The booking race: two customers cannot both hold the same start time for one business.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gm_booking_requests_slot
    ON gm_booking_requests (client_id, slot_date, slot_time) WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS idx_gm_booking_requests_lead ON gm_booking_requests (client_id, lead_id);
