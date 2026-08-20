-- A third reminder template: in-person, with no address to give.
--
-- WHY IT EXISTS. reminder_in_person embeds {location}, read from
-- sessions.location. On 2026-08-20 that column was NULL on all 132 in-person
-- client meetings booked since June -- every single one. The guard on the
-- dashboard card was doing its job (an empty {location} would have sent a
-- client "O endereço é: ."), but it was guarding a field nothing in the app
-- ever fills for a client meeting, so the in-person reminder could never be
-- sent by anyone, on any device.
--
-- clients.location is NOT a substitute: it holds "TAMPA, FL", "LAND O LAKES,
-- FL" -- a city, not somewhere you can tell a client to drive to.
--
-- So the card now asks for the address on click and offers to send without
-- one. This is the text for that second path: same message, minus the
-- sentence that has nothing to fill it. It is a SEPARATE ROW rather than
-- string surgery on reminder_in_person, so Alice can word the no-address
-- version herself instead of getting whatever a regex left behind.
--
-- Deliberately NO {location} token. A template edited to reintroduce it here
-- would ship the literal "{location}" to a client -- exactly the class of bug
-- that put "[PENDING_GOOGLE_API]" in a real WhatsApp message in July.
INSERT OR IGNORE INTO message_templates (template_key, template_text) VALUES
  ('reminder_in_person_no_address',
   'Passando para confirmar nossa reunião {when} às {time}. Até breve!');
