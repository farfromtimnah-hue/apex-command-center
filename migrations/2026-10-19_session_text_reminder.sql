-- Task 1.5: text reminders for meetings. A hand-made meeting (calendar.html
-- or client.html's Schedule modal) sends a text ONLY when this was ticked at
-- creation time (default 0/unticked). A meeting made by Apex admin on a
-- client's behalf or booked through the scheduling link has its OWN rule
-- (always eligible, subject to the global switches and caps) and does not
-- read this column -- see sessionGetsTextReminder in worker/index.js.
ALTER TABLE sessions ADD COLUMN send_text_reminder INTEGER NOT NULL DEFAULT 0;
