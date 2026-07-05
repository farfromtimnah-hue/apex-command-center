-- Temporary test data for pricing success-path verification.
-- DO NOT apply again — already executed against live D1 on 2026-07-04.
-- Cleanup: DELETE FROM packages WHERE id = 'pkg_test';
--          UPDATE clients SET package = NULL WHERE id = 'test-client-temp-001';

INSERT INTO packages (id, name, short_name, full_name, base_price, has_payment_plan, sort_order)
VALUES ('pkg_test', 'TEST-PKG', 'TEST-PKG', 'TEST PACKAGE - DO NOT USE', 100.0, 0, 999);

UPDATE clients SET package = 'TEST-PKG' WHERE id = 'test-client-temp-001';
