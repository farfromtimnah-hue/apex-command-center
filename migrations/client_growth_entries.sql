-- Sales Dashboard + Client Growth Tracking — monthly growth entries.
-- Spec: apex-status.md → "New Feature — Sales Dashboard + Client Growth Tracking".
--
-- Every active client gets one growth percentage entered per month by
-- Rafa/Alice (their own assessment from the monthly meeting — not
-- auto-calculated from revenue). The "top 3" monthly recognition is derived
-- at query time (rank by growth_percent DESC for a month_label), never
-- stored as a flag, so no client ever has a data gap.

CREATE TABLE IF NOT EXISTS client_growth_entries (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  month_label    TEXT NOT NULL,              -- 'YYYY-MM' (e.g. '2026-07')
  growth_percent REAL NOT NULL,              -- e.g. 345 = +345%; negatives allowed
  entered_by     TEXT,
  entered_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, month_label)            -- one entry per client per month
);

CREATE INDEX IF NOT EXISTS idx_growth_month  ON client_growth_entries (month_label);
CREATE INDEX IF NOT EXISTS idx_growth_client ON client_growth_entries (client_id);
