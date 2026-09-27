-- Hero follow-up (2026-09-27), E2 backfill, run ONCE: every paused or closed
-- client EXCEPT the test fixture remembers its current switch values and has
-- both switches OFF, stamped 'system'. Leads, merged and active untouched.
UPDATE clients SET
    daily_log_before_pause = daily_log_enabled,
    goals_before_pause = goals_enabled,
    daily_log_enabled_set_by = CASE WHEN daily_log_enabled = 0 THEN daily_log_enabled_set_by ELSE 'system' END,
    daily_log_enabled_set_at = CASE WHEN daily_log_enabled = 0 THEN daily_log_enabled_set_at ELSE datetime('now') END,
    goals_enabled_set_by = CASE WHEN goals_enabled = 0 THEN goals_enabled_set_by ELSE 'system' END,
    goals_enabled_set_at = CASE WHEN goals_enabled = 0 THEN goals_enabled_set_at ELSE datetime('now') END,
    daily_log_enabled = 0,
    goals_enabled = 0
WHERE status IN ('paused', 'closed') AND id <> 'test-client-temp-001';
