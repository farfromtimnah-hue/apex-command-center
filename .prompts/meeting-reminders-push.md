Apex Command Center. Repo: /Users/nicolel/apex-command-center. Branch: main.

Build push notifications that tell Rafa about the meetings on his own calendar.

WHAT ALREADY EXISTS - do not rebuild any of it:
- sendApns() in worker/index.js delivers to APNs. It is built, tested and proven
  working on a real device. It picks the APNs host per device from
  apns_device_tokens.environment ('sandbox' vs 'production') and there is a comment
  above it explaining why sending to the wrong host returns BadDeviceToken. Leave
  that logic alone.
- Tables: apns_device_tokens (token, user_email, environment, bundle_id,
  device_model, created_at, last_sent_at, last_error), push_sent_log,
  push_subscriptions.
- The iOS app already has the aps-environment, Data Protection and Time Sensitive
  Notifications entitlements. Do not edit ios/ at all in this prompt.
- A 4-hourly cron already runs in wrangler.toml (crons = ["0 */4 * * *"]) calling
  the scheduled handler in worker/index.js.

THE GAP: nothing ever calls sendApns for a meeting. push_sent_log is empty and
last_sent_at is null on every token row. The delivery pipe works; nothing decides
when to send.

BUILD THIS:

1. A reminder job that finds meetings starting soon and pushes the person whose
   calendar they are on. Rafa's user_email is abnerprata@gmail.com. Alice has two
   rows: Alicecorsino12@gmail.com and alicecorsinoprata@gmail.com.

2. Timing: one reminder the evening before (a digest of tomorrow's meetings) and
   one 15 minutes before each meeting starts. The existing cron is every 4 hours,
   which is far too coarse for a 15-minute warning - change the cron schedule to
   every 5 minutes and make the scheduled handler cheap enough to run that often.
   Do not remove the existing 4-hourly integration health check; keep it running on
   its own interval inside the handler rather than deleting it.

3. Never send the same reminder twice. Record every send in push_sent_log with
   enough detail to dedupe on (session_id, reminder_kind) and check it before
   sending. A missed reminder is bad; a repeated one at 6am is worse.

4. The 15-minute reminder must set aps.interruption-level = "time-sensitive" in the
   payload so it pierces Focus. The entitlement is already granted but the flag is
   what actually does it - without it the notification is held for the summary,
   which for two overloaded people is the same as never arriving. The evening
   digest is NOT time-sensitive; leave it at the default level.

5. Tapping a notification should open the app to that meeting. Put the session_id
   in the payload and handle it on the client.

6. Content, in Portuguese with an English equivalent where the codebase pairs them:
   the client or meeting name, the time in 12-hour format with AM/PM, and the
   location or the fact that it is online. Times in D1 are UTC - convert to Eastern
   before rendering. sessions.end_time deliberately holds two shapes ("HH:MM" from
   the app, full ISO from the Google sync); use endTimeHHMMFromRow() and never
   slice it raw.

7. Skip meetings whose status is cancelled, discarded or archived.

ONE-SHOT PERMISSION PROMPT - important. iOS asks for notification permission ONCE.
If it is declined the only recovery is the user going into Settings, which will not
happen. Do NOT ask on app launch. Ask right after Rafa books a meeting, at the
moment the value is obvious, and only if permission has not already been decided.
If a token already exists for that user, never prompt again.

PROJECT RULES:
- var, never const or let. Regular function(), never arrow functions. No
  localStorage for language or state. window.onload wraps init calls. Null check
  every getElementById. No IntersectionObserver. Plain ASCII only in JS strings:
  no accented characters, no em dashes, no emoji.
- progress.md is 512KB. Do NOT read it in full; grep it only for specific
  precedent. Update it at the end and stage it in the SAME commit as the code -
  never a progress.md-only commit afterward, because two Pages runs back to back
  cancel the older one.
- All filenames lowercase. Never delete files, tables or records. Do not run git
  pull. Do not change repo visibility.
- Deploy the worker yourself: npx wrangler deploy. Apply any migration yourself:
  npx wrangler d1 execute apex-command-center --remote --file=... Never print
  commands for a human to paste.
- The pre-commit hook stamps version.json and sw.js. Do not hand-stamp. Run
  sh scripts/build-webdir.sh && npx cap sync ios before committing or the drift
  guard blocks it.
- dashboard.html, calendar.html and client.html each keep their own copy of shared
  logic. Grep all three before assuming a change landed everywhere.
- Portuguese is client-facing. New strings need show-pt and show-en spans matching
  the surrounding code. Do NOT reword existing copy.

DO NOT BUILD: auto-summarizing transcripts, anything touching the PDF template,
a share sheet or contact-exchange feature, or notification badges (badges were
deliberately removed - do not reintroduce them).

VERIFICATION. A database query is not verification and neither is a passing test.
Send a real push to Nicole's registered device (user_email
nlepage.ao.ail@gmail.com, environment 'production') and confirm it arrives, that
the 15-minute one is marked time-sensitive, and that tapping it opens the right
meeting. Confirm the dedupe by running the job twice and showing the second run
sends nothing. Report which checks need Nicole on a device.

When done: update progress.md, stage it with the code, one commit, push, deploy
the worker, then stop and report.
