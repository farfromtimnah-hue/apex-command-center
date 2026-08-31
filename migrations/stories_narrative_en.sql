-- The English narrative, alongside the Portuguese `narrative`.
-- Meeting Prep renders `narrative` in PT and `narrative_en` in EN, falling
-- back to `narrative` while a row's English copy is still empty, so the story
-- body never renders blank mid-meeting.
ALTER TABLE stories ADD COLUMN narrative_en TEXT;
