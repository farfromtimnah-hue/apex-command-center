-- Apex Club registration: the guest's business name (2026-10-04).
-- Applied by hand: npx wrangler d1 execute apex-command-center --remote --file migrations/apex_club_company.sql
-- Check PRAGMA table_info(apex_club_registrations) first and skip the ALTER
-- if the column is already there (SQLite has no ADD COLUMN IF NOT EXISTS).
-- NULL means the guest gave none: the RSVP is the food count and is never
-- refused over a missing company.
ALTER TABLE apex_club_registrations ADD COLUMN company TEXT;
