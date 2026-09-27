-- Hero build (2026-09-27), checkpoint E: Pr. Rafa's per-client switches for the
-- daily log and the monthly goals. Both default ON (1) for every client, so
-- nothing changes until an admin flips one. Who changed a switch and when
-- follows the clients.next_step_set_by / next_step_set_at convention.
-- Run ONCE against remote D1; verify with PRAGMA table_info(clients).
ALTER TABLE clients ADD COLUMN daily_log_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN daily_log_enabled_set_by TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN daily_log_enabled_set_at TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN goals_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN goals_enabled_set_by TEXT DEFAULT NULL;
ALTER TABLE clients ADD COLUMN goals_enabled_set_at TEXT DEFAULT NULL;
