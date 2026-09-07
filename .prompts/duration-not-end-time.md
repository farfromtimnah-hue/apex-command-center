Apex Command Center. Repo: /Users/nicolel/apex-command-center. Branch: main.

THE PROBLEM

The Nova Sessao dialog in calendar.html asks for a start time AND an end time
(HORA and HORA DE TERMINO) for every meeting type except church. That is the
Google Calendar behaviour Nicole specifically does not want. Nobody thinks "this
meeting ends at 3:30" -- they think "it starts at 2 and runs an hour."

A duration picker ALREADY EXISTS and already works, but it was built for church
meetings only: the select is #nsChurchDuration inside #nsChurchDurationGroup, and
applyNsChurchDuration() computes #nsEndTime from #nsTime plus the chosen minutes.
It is hidden for every other type.

WHAT TO BUILD

Make start-time-plus-duration the way EVERY meeting type is booked. Duration
defaults to 1 hour and is changeable.

1. Rename the control off "church" since it is no longer church-specific --
   #nsDurationGroup / #nsDuration / applyNsDuration() / onNsDurationChange(). Grep
   for every reference to the old names, including the edit-session dialog, and
   update them all. Do not leave a half-renamed pair.

2. Show it for EVERY meeting type. Default 60 minutes on open, for all types.

3. Remove HORA DE TERMINO from the dialog as a thing the user picks. end_time is
   still what gets stored and sent to Google -- keep computing it from start +
   duration, exactly as applyNsChurchDuration already does. Do not change the
   database, the worker payload, or anything Google-facing. This is a UI change
   only.

4. Keep the existing duration options (30 min, 1 hora, 1 hora e 30, 2 horas,
   3 horas) and ADD longer ones, because on-site visits are genuinely long: 4
   horas, 6 horas, 8 horas. Real bookings in the data run 3 to 8 hours.

5. Keep the "Dia inteiro" (all day) checkbox working. It currently belongs to the
   church block; it should now apply to every type too, and when ticked it
   continues to override the duration.

6. The EDIT dialog (Editar Sessao) must match. If it still asks for an end time
   directly, give it the same duration control, pre-selected to the meeting's
   current length. If the existing length is not one of the options -- an imported
   Google meeting can be any length -- add a "Personalizado" option showing the
   real value so editing an odd-length meeting does not silently round it.

7. sessions.end_time deliberately holds TWO shapes: "HH:MM" written by the app and
   a full ISO datetime written by the Google Calendar sync. endTimeHHMMFromRow()
   in worker/index.js normalizes it, and calendar.html has its own endTimeHHMM().
   Use those. NEVER slice the raw value, and never migrate stored values -- 104
   rows hold the ISO shape and they are correct as they are.

PROJECT RULES
- var, never const or let. Regular function(), never arrow functions. No
  localStorage for language or state. window.onload wraps init calls. Null check
  every getElementById. No IntersectionObserver. Plain ASCII only in JS strings:
  no accented characters, no em dashes, no emoji. Portuguese UI strings in HTML
  use show-pt / show-en spans and HTML entities, matching the surrounding code.
- Do NOT reword any existing copy that is not part of this change.
- progress.md is 512KB. Do NOT read it in full. Update it at the end and stage it
  in the SAME commit as the code -- never a progress.md-only commit afterward.
- calendar.html, dashboard.html and client.html each keep their own copy of shared
  logic. Grep all three.
- Run sh scripts/build-webdir.sh && npx cap sync ios before committing or the
  drift guard blocks it.
- Deploy the worker yourself if you touch it: npx wrangler deploy. Never print
  commands for a human to paste.
- The pre-commit hook stamps version.json and sw.js. Do not hand-stamp.

VERIFICATION. Drive the real UI, not a test suite.
Book one meeting of each type and confirm end_time in D1 equals start plus the
chosen duration. Confirm the default is 60 minutes on every type. Confirm all-day
still works. Open an EXISTING meeting whose length is not a listed option and
confirm editing it does not change its length. Check the console for errors and
test both PT and EN.
Note: the live site DOES load in a browser when signed in, but a stale service
worker will serve the old file -- after deploying, unregister the service worker
and hard-reload before concluding anything about what is live.

When done: update progress.md, stage it with the code, one commit, push, and
report what was verified versus what needs Nicole on a device.

=== SECOND TASK, SAME SESSION: voice-booked meetings never reach Google ===

handlePostSessionsVoice() in worker/index.js hardcodes google_meet_link to NULL
and calendar_provider to 'apex' when it inserts the session. So a meeting booked
by voice exists ONLY inside Apex: it never appears on Rafa's phone calendar, it
never reminds him, it has no Meet link to join, and Fireflies never captures a
transcript for it because there is no Meet to sit in. From his side, speaking a
meeting produces something invisible everywhere he actually looks.

The worker ALREADY knows how to do this. It creates real Google Calendar events
with Meet links on the normal booking path -- search for conferenceData and
createRequest with conferenceSolutionKey type "hangoutsMeet", and for the
/events?conferenceDataVersion=1 call. Reuse that code. Do not write a second
Google integration and do not add new credentials: the OAuth token and its
refresh already exist and are already used by the scheduled handler.

Build it so that:

1. A voice-booked meeting creates the real Google Calendar event, exactly as the
   dialog path does for the same meeting type, and stores google_event_id,
   html_link and calendar_provider the same way.

2. An ONLINE meeting gets a Meet link, stored in google_meet_link. An in-person
   one does not -- same rule the dialog already follows, so an on-site visit or a
   personal block is not handed a dead conference room.

3. The Google call is BEST EFFORT and must never lose the meeting. The whole
   design of this path is that speaking always produces a meeting: a missing date
   falls back to today rather than refusing. Keep that. If Google fails for any
   reason -- expired token, API error, network -- the session row is still
   inserted, the meeting is flagged for Alice, and the reason is recorded. Never
   let a Google failure throw away a recording Rafa already made.

4. When Google fails, say so on the calendar banner in plain language: this
   meeting is not on Google yet. Alice can then finish it through the normal
   dialog, which does create the event. Do not invent a new surface for this --
   use the voice flag banner that already exists.

   READ THIS BEFORE YOU DESIGN THE FALLBACK. Alice's desk is NOT the default
   path, and building it that way fails the whole point of this feature. Every
   voice-booked online meeting MUST get its Google event and Meet link created
   automatically, with no human touching it. The banner is for the rare genuine
   failure -- an expired token, a Google outage -- not for routine completion.
   If your implementation ends up routing ordinary successful bookings to Alice
   for a manual step, it is wrong: rework it so the automatic path is the one
   that runs, because a system that quietly moves work onto her will be
   abandoned rather than used.

   Concretely: do NOT add session_type, meeting link, or "needs Google" to the
   `missing` array for meetings that succeeded. A meeting whose Google event was
   created is complete and must not be flagged at all.

5. Retry once before giving up. An expired OAuth token is the most likely
   failure and the worker already knows how to refresh it, so a single retry
   after a refresh will turn most would-be failures into successes that never
   reach anyone. Only flag after that retry also fails.

VERIFY THIS PART by speaking (or posting synthesized audio for) one ONLINE
meeting and one ON-SITE meeting, then confirming in D1 that the online one has a
google_meet_link and a google_event_id and the on-site one has an event but no
Meet link. Then confirm the event actually exists in Google Calendar, not just
that a column was filled in. A row with an id in it is not proof the event was
created -- fetch it back.
