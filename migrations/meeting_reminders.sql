-- Meeting Reminders (Alice's dashboard)
--
-- Two templates, because the content genuinely differs by meeting type: an
-- online meeting carries the Google Meet link, an in-person one carries the
-- street address from sessions.location.
--
-- {when} resolves to the literal word "hoje" / "amanha", never a calendar
-- date, and is computed on the PAGE -- the worker has no datetime helpers and
-- hand-building a date string there is how a wrong-format date ships.
INSERT OR IGNORE INTO message_templates (template_key, template_text) VALUES
  ('reminder_online',
   'Olá, {name}! Passando para confirmar nossa reunião {when} às {time}. O link está aqui: {meetLink}. Até breve!'),
  ('reminder_in_person',
   'Olá, {name}! Passando para confirmar nossa reunião {when} às {time}. O endereço é: {location}. Até breve!');

-- Its OWN column. sessions.whatsapp_sent_at belongs to the booking
-- CONFIRMATION message; reusing it would make a confirmation sent three days
-- ago mark today's meeting as already reminded.
ALTER TABLE sessions ADD COLUMN reminder_sent_at TEXT;
