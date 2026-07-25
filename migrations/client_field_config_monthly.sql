-- Per-month goals + approval flow (2026-07-25).
-- client_field_config gains a month_label ('YYYY-MM') in the PK so a goal can
-- vary by month, plus proposal/approval columns. Existing rows are migrated to
-- the current month, preserving enabled and meta_mensal. Standard SQLite
-- table-rebuild pattern (create new, copy, drop old, rename) — no data loss.
--
-- Goal resolution (worker/index.js getFieldConfig): reading month M uses M's
-- row; if absent, falls back to the most recent prior month's row. So a client
-- who sets goals once keeps them until they change them, and past months keep
-- the targets that were live at the time.

CREATE TABLE client_field_config_new (
  client_id      TEXT NOT NULL,
  indicator_key  TEXT NOT NULL,
  month_label    TEXT NOT NULL,               -- 'YYYY-MM'
  enabled        INTEGER NOT NULL DEFAULT 1,
  meta_mensal    REAL,                        -- the ACTIVE (approved) goal
  set_by         TEXT,                        -- 'client' | 'admin'
  status         TEXT NOT NULL DEFAULT 'approved',  -- 'pending' | 'approved' | 'rejected'
  proposed_value REAL,                        -- client's proposed new goal (while status='pending')
  proposed_at    TEXT,
  proposed_by    TEXT,
  decided_at     TEXT,
  decided_by     TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, indicator_key, month_label)
);

INSERT INTO client_field_config_new
  (client_id, indicator_key, month_label, enabled, meta_mensal, set_by, status, updated_at)
SELECT client_id, indicator_key, strftime('%Y-%m','now'), enabled, meta_mensal, 'admin', 'approved', updated_at
FROM client_field_config;

DROP TABLE client_field_config;

ALTER TABLE client_field_config_new RENAME TO client_field_config;
