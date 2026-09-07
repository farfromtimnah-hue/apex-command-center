Apex Command Center. Repo: /Users/nicolel/apex-command-center (this clone, not any other).
Branch: main. Build all three parts below.

PROJECT RULES - follow all of these.

JS conventions for every file you touch:
- var, never const or let
- regular function(), never arrow functions
- no localStorage for language or state
- window.onload wraps all init calls
- null check on every getElementById
- no IntersectionObserver
- plain ASCII only in JS strings and data arrays: no accented characters, no em dashes, no emoji

progress.md lives in the repo root. Do NOT read it in full - it is 512KB and a full read
fails. Grep it only if you need precedent for a specific past decision. Update it at each
checkpoint and stage it in the SAME commit as that checkpoint's code. Never make a
progress.md-only commit afterward: a code commit followed seconds later by a progress-only
commit fires two GitHub Pages runs back to back and the older one gets cancelled, which
looks exactly like a platform outage.

All filenames lowercase. Never delete files, tables or records. Do not change the repo's
visibility. Do not run git pull.

Deploy the worker yourself: npx wrangler deploy
Apply D1 migrations yourself: npx wrangler d1 execute apex-command-center --remote --file=...
Never print commands for a human to paste.

The pre-commit hook stamps version.json and sw.js. Do not hand-stamp them. www/ is what
Capacitor builds iOS from and is gitignored, so run this before each commit or the drift
guard blocks it: sh scripts/build-webdir.sh && npx cap sync ios

dashboard.html, calendar.html and client.html each keep their own copy of shared logic.
Grep all three before assuming a change landed everywhere.

Portuguese is the client-facing language. Every new string needs show-pt and show-en spans
matching the surrounding code. Do NOT reword any existing copy.

sessions.end_time deliberately holds TWO shapes: "HH:MM" written by the app, and a full ISO
datetime written by the Google Calendar sync. endTimeHHMMFromRow() in worker/index.js
normalizes it. Always use that function. Never slice the raw value. Never migrate stored
values.

session_clients already exists in remote D1 with 197 rows. Columns: session_id, client_id,
is_primary, source, note, created_at, created_by. GATOR OUTDOOR LIVING and MY PURE FILTER
are already both linked to the six "Marcelinho" sessions.

PART 1 - MEETING TYPES

sessions.meeting_category today allows: client, prospective, event, vendor, personal.
"event" has become a junk drawer holding kids birthdays, church meetings, X-Rays and
networking dinners all at once. Personal items are also landing in "client".

Restructure the booking dialog in calendar.html so MEETING TYPE IS THE FIRST QUESTION and
the rest of the form changes based on it. Types and their behavior:

client_meeting - existing behavior, client required.
onsite_visit - NEW. Client required, in_person. Must show in that client's history and be
  countable separately from weekly meetings. The get-directions button must work exactly as
  it does for any in_person client meeting.
xray - NEW. Client required, but the picker shows LEADS FIRST with "+ Novo cliente" pinned
  at the very top.
church - NEW. No client. An optional meeting-link field hidden until the user clicks a small
  "adicionar link" affordance. A duration picker. An all-day checkbox.
personal - a time block, visible to Rafa AND Alice, never to any client. Include a checkbox
  meaning someone else is covering the kids: when ticked the block still displays but does
  NOT prevent booking over that time.
vendor - unchanged.
event - keep for Apex Club and conferences only.

The client dropdown must keep its existing grouping and placeholder-first default. See
populateSchedClientSelect() in calendar.html: active clients, then leads, then archived and
past, with a placeholder selected so sending requires a deliberate choice. Do not regress
this. For xray ONLY, reorder so leads come first and pin the new-client option on top.

"+ Novo cliente" opens a minimal inline form asking for business name and phone. Nothing
else. It creates a clients row with status 'lead'. Then offer the EXISTING credentials and
WhatsApp send flow already in the codebase. Do not build a second one.

Do NOT block booking an X-Ray when the assessment is not complete. Attach the meeting to the
client and let prep surface the gap later. Blocking is what makes him stop using the tool.

Also change the default for a new client from 'active' to 'lead': both in clients.html
(around line 2328, the `|| "active"` fallback) and the clients table DEFAULT. Someone becomes
active when they have a contract, which means they have a package. Do NOT add a required
package question at creation. Put the package requirement on the lead-to-active promotion
instead. Do not backfill or guess any existing client's package.

CHECKPOINT: update progress.md, stage it with the code, run the webdir build and cap sync,
then git add -A && git commit && git push origin main. Deploy the worker if it changed.

PART 2 - MULTI-CLIENT MEETINGS

One meeting can be about two companies. Marcelo Diniz owns both GATOR OUTDOOR LIVING and
MY PURE FILTER and Rafa holds a single weekly block covering both businesses.
sessions.client_id cannot express that, which is why session_clients exists.

- Client profile and history reads must go through session_clients, not only
  sessions.client_id, so a shared meeting appears on BOTH client profiles.
- Session notes and transcripts stay on the session row and are SHOWN from both profiles.
  Do NOT copy them per client: two copies would diverge with nothing to say which is true.
- In meeting-prep.html, when a session links to more than one client, render one TAB PER
  COMPANY. Each tab asks its own meeting type independently, and "sem preparacao" (no prep
  for this company) must be a valid choice on a tab.
- Add a way to link a second client to an existing meeting from the calendar detail modal.

CHECKPOINT: same as Part 1 - progress.md staged with the code, one commit, push, deploy.

PART 3 - VOICE BOOKING

Rafa is overloaded and the booking dialog's questions are what he routes around. Give him a
microphone button on the dashboard: he speaks the meeting and it gets created.

- Add the Workers AI binding to wrangler.toml and transcribe with @cf/openai/whisper. Cap the
  recording length so a phone left recording in a pocket cannot run up cost.
- Extract the fields with Claude. CLAUDE_API_KEY is ALREADY a worker secret; do not add one.
- Give the model the full client roster INCLUDING the owners column. Rafa often says the
  owner's name rather than the business: "Marcelinho" means Marcelo Diniz, who owns BOTH
  Gator and My Pure Filter. Brazilian diminutives are normal and expected, so Marcelo becomes
  Marcelinho and the model must resolve that.
- The matcher returns one of THREE verdicts, never two:
  confident - attach the client
  ambiguous - create the meeting unlinked and flag it
  not a client meeting - create it and do NOT flag it
  A first name shared by two different clients is ambiguous, never a guess. Party, wedding,
  birthday or shower vocabulary means personal even when an owner name matches: a real example
  is "Cha de panela Iasmin", a bridal shower, where Iasmin is an owner of PRODUWALL.
- ALWAYS create the meeting from whatever he said. Ask ONE follow-up question when something
  essential is missing, but never block on the answer. If he walks away, save what is known
  and flag it.
- The flag surface is a banner ABOVE THE CALENDAR on calendar.html, not on the dashboard.
  Clicking it opens a modal pre-filled with what was captured, showing which fields are
  missing so Alice can complete it. Hide the banner when nothing is pending.

CHECKPOINT: same as Part 1 - progress.md staged with the code, one commit, push, deploy.

DO NOT BUILD ANY OF THIS
- auto-summarizing transcripts. This is deliberate: the summary feature is not being used and
  we are not paying per-call API cost on an automatic basis.
- anything touching the PDF template or its section structure
- push notifications, the Data Protection entitlement, or a share sheet
- clearing the existing backlog of unsummarized sessions

VERIFICATION. A passing test suite is not verification, and neither is a database query.
Drive the real UI. Book one meeting of EACH new type and confirm it lands in D1 with the
right meeting_category, the right client link, and a working directions or join button.
Confirm a personal block with the covering-the-kids box ticked does not prevent booking over
it. Confirm the X-Ray picker shows leads first with the new-client option on top. Check the
browser console for errors and test both PT and EN language states.
Apex will NOT load in a sandboxed browser: verify served content with curl and report which
checks need Nicole on a real device.

After Part 3's push and deploy, STOP and report what was verified in the real UI versus what
still needs Nicole on a device.
