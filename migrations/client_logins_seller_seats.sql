-- Salesperson seats (2026-08-02): make client_logins hold more than one login
-- per business, so an owner login can coexist with N salesperson logins.
--
-- WHY THE REBUILD. client_logins.client_id carried a UNIQUE constraint, which
-- is precisely what capped a business at exactly one login. SQLite cannot drop
-- a constraint in place, so this is the standard 12-step table rebuild:
-- create the new table, copy every row, drop the old, rename. There are 13
-- live logins at the time of writing and 9 belong to real paying clients, so
-- the copy is verified by count on both sides of the swap.
--
-- WHAT CHANGES:
--   client_id  loses UNIQUE, gains a plain index (it is now the non-unique
--              lookup key -- "every login at this business").
--   username   stays PRIMARY KEY. Usernames remain globally unique; that is
--              what POST /api/auth/client-login resolves against, and it is
--              why the seller username generator suffixes on collision.
--   role       'client' (the business owner) or 'seller' (their salesperson).
--              Every pre-existing row is an owner, hence the DEFAULT and the
--              literal in the SELECT below.
--   seller_name NULL for role='client'. For a seller this is the name that
--              must match gm_leads.vendedor for a row to be visible to them.
--              The worker keys row-level filtering off THIS column, read from
--              the session -- never off anything the browser sends.
--
-- UNIQUE (client_id, seller_name) stops one business holding two seats for the
-- same salesperson. SQLite treats NULLs as distinct in a UNIQUE index, so this
-- does NOT constrain the role='client' rows (all of which have seller_name
-- NULL) -- multiple owner rows would still be permitted by the constraint
-- alone. That is fine: nothing creates a second owner row, and the seat
-- creation path is the only writer of role='seller'.
--
-- DEPLOY ORDER: apply this to remote D1 BEFORE deploying worker code that
-- reads role/seller_name. Deploying first has taken this app down before.

-- No explicit BEGIN/COMMIT and no PRAGMA foreign_keys here: D1 rejects
-- BEGIN TRANSACTION outright ("please use state.storage.transaction()"), and
-- it already applies a multi-statement file atomically -- a failure part-way
-- rolls the whole file back. Adding them is not belt-and-braces, it is an
-- error that stops the migration running at all.

CREATE TABLE client_logins_new (
  username             TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  tracking_start       TEXT,
  password_changed_at  TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  work_schedule        TEXT,
  created_by           TEXT,
  role                 TEXT NOT NULL DEFAULT 'client',
  seller_name          TEXT,
  UNIQUE (client_id, seller_name)
);

-- Column list is explicit on both sides: an INSERT ... SELECT * would bind by
-- position and silently misalign the moment the old table's column order
-- differs from what is written above.
INSERT INTO client_logins_new (
  username, client_id, password_hash, must_change_password, tracking_start,
  password_changed_at, last_login_at, created_at, work_schedule, created_by,
  role, seller_name
)
SELECT
  username, client_id, password_hash, must_change_password, tracking_start,
  password_changed_at, last_login_at, created_at, work_schedule, created_by,
  'client', NULL
FROM client_logins;

DROP TABLE client_logins;

ALTER TABLE client_logins_new RENAME TO client_logins;

-- client_id is no longer UNIQUE, so it no longer carries an implicit index.
-- Every "who logs in at this business" read (the profile card's seat list,
-- the owner-row lookups) hits this.
CREATE INDEX IF NOT EXISTS idx_client_logins_client
  ON client_logins (client_id);
