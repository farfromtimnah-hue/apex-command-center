-- Free-text street address for in-person sessions and event entries
-- (conferences, Apex Club). Shown in the calendar detail modal with a
-- Directions button that builds an Apple/Google Maps link from it, so it
-- should hold a real street address, not "Rafa's office".

ALTER TABLE sessions ADD COLUMN location TEXT;
