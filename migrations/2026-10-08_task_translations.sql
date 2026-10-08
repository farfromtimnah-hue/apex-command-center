-- Task translation (RES-55): a task that involves the developer, and the notes
-- on it, keep their words a second time in the other language.
--
-- ALREADY RUN on the live database by Rez. This file is the record: do not
-- run it again (SQLite refuses to add a column that is already there).
--
-- The original words stay in tasks.description and task_notes.body, unchanged.
--   description_en / body_en   what rafa or alice wrote, in English
--   description_pt / body_pt   what the developer wrote, in Portuguese of Brazil
-- NULL everywhere else: a task that does not involve the developer, an old
-- row, or a translation that did not arrive. Additive only; no row is changed.

ALTER TABLE tasks ADD COLUMN description_en TEXT;
ALTER TABLE tasks ADD COLUMN description_pt TEXT;
ALTER TABLE task_notes ADD COLUMN body_en TEXT;
ALTER TABLE task_notes ADD COLUMN body_pt TEXT;
