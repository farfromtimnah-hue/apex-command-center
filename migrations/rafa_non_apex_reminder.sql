-- Rafa's non-Apex reminder: ONE message listing his 'event' and 'personal'
-- calendar items still upcoming today and tomorrow, sent from calendar.html.
--
-- {greeting} and {items} are the only tokens. {greeting} is supplied per send
-- (Bom dia / Boa tarde / Boa noite) from calendar.html's rafaGreeting(). The
-- item list is generated per send from however many rows exist, so it cannot
-- be a template field; the template owns the
-- greeting and the closing line around it. There is deliberately no {date} or
-- {time} token -- those belong to the individual rows inside the generated
-- list, not to the message as a whole.
--
-- The accented Portuguese lives HERE, in the D1 row, because a JS string
-- literal in this project must stay plain ASCII.
INSERT INTO message_templates (template_key, template_text, updated_at, updated_by)
VALUES ('rafa_non_apex_reminder', '{greeting}! Isto é o que você tem:

{items}
Qualquer mudança, é só me avisar.', datetime('now'), 'session-89')
ON CONFLICT(template_key) DO UPDATE SET template_text = excluded.template_text;
