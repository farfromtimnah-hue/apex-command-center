-- doc_links.client_id: make it NULLABLE (2026-10-10).
--
-- Apex Club event links are the first doc_links kind with no client at all --
-- Club events are not scoped to any one business (see apex_club_events, and
-- the "Apex Club is the one thing every client business has in common"
-- comment in gmClubInviteEvents). SQLite cannot drop a NOT NULL constraint
-- with ALTER TABLE, so this is a table rebuild, same recipe as
-- gm_config_target_margin_nullable.sql.
--
-- Every existing row (contracts, estimates, invoices, apex-contract,
-- apex-invoice) already carries a real client_id and is copied over
-- unchanged. Only new "club" rows will ever insert NULL here.

CREATE TABLE doc_links_new (
  slug          TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  public_token  TEXT NOT NULL,
  client_id     TEXT,
  title         TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO doc_links_new (slug, kind, public_token, client_id, title, description, created_at)
SELECT slug, kind, public_token, client_id, title, description, created_at
FROM doc_links;

DROP TABLE doc_links;

ALTER TABLE doc_links_new RENAME TO doc_links;

CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_links_token ON doc_links (kind, public_token);
