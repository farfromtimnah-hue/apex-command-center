-- Per-person language preference (Group 1.1, 2026-10-19). Additive only.
--
-- login_people.language: the passkey-login person's own saved preference
-- ('pt' or 'en'). NULL means "not chosen yet" -- an owner (role='client')
-- with NULL defaults to 'pt' in code (Pr. Rafa consults in Portuguese); every
-- other role (partner/staff_finance/staff/seller) with NULL has not been
-- asked yet and the UI shows the first-sign-in language card.
--
-- users.language: the same idea for a Google/Firebase staff sign-in
-- (alice/rafa/developer). NULL defaults to 'pt' in code, same as an owner.
--
-- Check each column is missing before running (D1/SQLite has no
-- ADD COLUMN IF NOT EXISTS): PRAGMA table_info(login_people) / PRAGMA
-- table_info(users), look for a row named "language".
ALTER TABLE login_people ADD COLUMN language TEXT;
ALTER TABLE users ADD COLUMN language TEXT;
