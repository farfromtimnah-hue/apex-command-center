-- Salesperson login requests (2026-08-02): a client asking us to give one of
-- their salespeople their own portal login.
--
-- THIS TABLE RECORDS A REQUEST. IT GRANTS NOTHING.
-- Writing a row here does not create a login, does not touch client_logins,
-- and does not give anybody access to anything. It is a queue that Rafa and
-- Alice work through by hand. Actual salesperson seats -- the authentication,
-- the scoped-pipeline reads -- are a separate future build. Nothing in this
-- migration should be read as that build having started.
--
-- The seat this anticipates, when it is built, is deliberately narrow: a
-- salesperson will see only the pipeline records they create or that are
-- assigned to them, and never the rest of the client's data (finance, jobs,
-- goals, base de ouro, the other salespeople's leads). The portal copy tells
-- the client that up front so the request is made with that understanding.
--
-- seller_name is the plain name string as typed into the client's Vendedores
-- list (gm_config.vendedores_json). It is NOT a foreign key -- that list is a
-- free-text JSON array a client can edit or delete at will, so the name here
-- is a snapshot of what they asked for. A request whose name later disappears
-- from their list simply stops matching, which is the correct outcome: the UI
-- only renders the button next to names that are currently in the list.
--
-- status: pending | approved | rejected. Approve/reject only stamp this row
-- (status + resolved_at + resolved_by). They provision nothing.
--
-- The UNIQUE (client_id, seller_name) constraint is what makes the button's
-- three states well-defined -- not requested / pending / approved -- and stops
-- a client queueing the same person twice by tapping twice. A client cannot
-- cancel a pending request in this pass; only an admin resolves it.

CREATE TABLE IF NOT EXISTS gm_seller_login_requests (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    seller_name   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
    requested_by  TEXT,
    resolved_at   TEXT,
    resolved_by   TEXT,
    UNIQUE (client_id, seller_name)
);

-- The admin queue view (GET /api/gm/seller-login-requests) reads every pending
-- row across all clients, oldest first.
CREATE INDEX IF NOT EXISTS idx_gm_seller_login_requests_status
    ON gm_seller_login_requests (status, requested_at);

-- The portal reads every request for one client to paint the button states.
CREATE INDEX IF NOT EXISTS idx_gm_seller_login_requests_client
    ON gm_seller_login_requests (client_id);
