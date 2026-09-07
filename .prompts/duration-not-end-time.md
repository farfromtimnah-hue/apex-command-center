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
