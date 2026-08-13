-- "Enviar horarios" — client-driven scheduling links.
--
-- WHY THIS EXISTS: Alice spends ~2 hours every Friday contacting consulting
-- clients ONE BY ONE over WhatsApp to negotiate a meeting time against Rafa's
-- calendar, plus daily reschedules. She named it her single biggest time cost
-- on 2026-08-12. This replaces the negotiation with a LINK: the client picks
-- from genuinely open slots and the booking writes itself.
--
-- THE ATOMICITY CONTRACT IS IN THIS FILE, NOT IN THE WORKER.
-- On 2026-08-03 a live client's assessment ended up with score_json and
-- completed_at written but status still 'in_progress' — a state no single code
-- path can produce. Two handlers wrote the same row; one read the row at entry,
-- passed its guard, then committed over the other. A guard that is a read taken
-- at entry DOES NOT WORK. So the "one winner per slot" rule is a UNIQUE INDEX
-- below, enforced by SQLite itself: the second concurrent booker's INSERT
-- raises a constraint error and there is no window in which both can pass.

-- ---------------------------------------------------------------------------
-- One row per "Alice asked this client to pick a time".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_requests (
    id            TEXT PRIMARY KEY,
    token         TEXT NOT NULL UNIQUE,   -- the opaque public URL segment
    client_id     TEXT NOT NULL,          -- ALWAYS the id. Never the name: the
                                          -- same client exists as 'METZ',
                                          -- 'RDE - METZ ' (trailing space) and
                                          -- 'METZ - RDE'. Name matching
                                          -- silently mis-attributes history.
    client_name   TEXT NOT NULL,          -- display snapshot only, never a key
    meeting_type  TEXT NOT NULL DEFAULT 'online_meet',  -- online_meet | in_person
    duration_min  INTEGER NOT NULL DEFAULT 60,
    travel_min    INTEGER NOT NULL DEFAULT 0,  -- in-person: blocked BEFORE and
                                               -- AFTER the slot
    buffer_min    INTEGER NOT NULL DEFAULT 0,  -- online opt-in, for a client
                                               -- who notoriously runs over
    location      TEXT,
    week_start    TEXT NOT NULL,          -- local YYYY-MM-DD (Monday). ONE week
                                          -- window, never two.
    week_end      TEXT NOT NULL,          -- local YYYY-MM-DD, inclusive
    status        TEXT NOT NULL DEFAULT 'waiting',
                                          -- waiting | booked | skipped | expired | none_work
    session_id    TEXT,                   -- set when booked
    booked_at     TEXT,
    skip_reason   TEXT,                   -- vacation | emergency | client_cancelled
    squeezed_out  INTEGER NOT NULL DEFAULT 0,
                                          -- this client lost a race for a slot.
                                          -- Alice must be TOLD, or she reads the
                                          -- silence as the client ignoring her.
    sent_at       TEXT,                   -- when she actually sent the WhatsApp
    -- The chase. The 24-business-hour flag identifies WHO to chase; the
    -- "Cobrar" button does the chasing, reusing the SAME token/link — the
    -- client may already have the original open in their browser and a fresh
    -- URL would invalidate it under them.
    followup_sent_at    TEXT,
    followup_count      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    created_by    TEXT,
    updated_at    TEXT,
    updated_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sched_req_status ON scheduling_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sched_req_client ON scheduling_requests(client_id);

-- ---------------------------------------------------------------------------
-- One row per CONFIRMED booking. This table exists for exactly one reason:
-- to carry the UNIQUE constraint that makes booking atomic.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_bookings (
    id          TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    slot_date   TEXT NOT NULL,   -- local YYYY-MM-DD
    slot_time   TEXT NOT NULL,   -- local HH:MM (24h)
    end_time    TEXT NOT NULL,
    session_id  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- THE GUARD. Two clients tapping the same slot seconds apart produce exactly
-- one winner: the loser's INSERT fails with SQLITE_CONSTRAINT and the handler
-- returns the remaining times instead of an error page. A loss becomes another
-- choice, not a dead end. Rafa can only be in one place at a time, so the
-- constraint is on (date, time) globally — NOT scoped per client or per
-- request, which would let two different clients book the same hour.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_booking_slot
    ON scheduling_bookings(slot_date, slot_time);

CREATE INDEX IF NOT EXISTS idx_sched_booking_req ON scheduling_bookings(request_id);

-- ---------------------------------------------------------------------------
-- "Something earlier?" / "Something later?" taps, and "None of these work".
--
-- Every tap is logged. Repeated taps in one direction mean the client's real
-- pattern has drifted away from what their history suggests, and the default
-- suggestion should move. Silence today cannot be distinguished from a client
-- ignoring Alice; this turns that into data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_feedback (
    id          TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,   -- earlier | later | none_work
    slot_date   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sched_feedback_client ON scheduling_feedback(client_id, kind);

-- ---------------------------------------------------------------------------
-- Availability settings — a single row (id='default'). Alice's one settings
-- page writes here; every slot computation reads here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduling_settings (
    id                TEXT PRIMARY KEY DEFAULT 'default',
    day_start         TEXT NOT NULL DEFAULT '09:00',
    day_end           TEXT NOT NULL DEFAULT '18:00',
    work_days         TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- 0=Sun .. 6=Sat
    min_notice_hours  INTEGER NOT NULL DEFAULT 4,   -- no booking 20 minutes out
    daily_cap         INTEGER NOT NULL DEFAULT 4,   -- a client-driven system must
                                                    -- not wall in Rafa's whole day
    default_duration  INTEGER NOT NULL DEFAULT 60,
    default_travel    INTEGER NOT NULL DEFAULT 30,
    updated_at        TEXT,
    updated_by        TEXT
);

INSERT OR IGNORE INTO scheduling_settings (id) VALUES ('default');
