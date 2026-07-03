# Apex Command Center — Build Progress

**Last updated:** 2026-07-03 (session 49 — tasks.html photo hero section with 5 stat tiles and relocated header controls)

## Completed (session 49 — 2026-07-03, tasks.html hero section)

- [x] Removed `padding: 28px 32px` from `#appMain`; added `.below-hero-section { padding: 28px 32px; display: flex; flex-direction: column; gap: 20px; }` per the calendar.html pattern
- [x] Wrapped `#tasksContainer` in `.below-hero-section` div (only tasksContainer goes in wrapper)
- [x] Added `.tasks-hero-section` as first child of `#appMain` with `#tasksHeroBg` (kenburns bg) + `#tasksHeroScrim` (dark overlay) + `.tasks-hero-content` wrapper
- [x] `initHeroBg('tasksHeroBg', 'tasksHeroScrim')` function added (exact same random-pick + onerror fallback pattern as other pages)
- [x] `initHeroBg` called from `setupPage()` alongside existing init logic
- [x] Glass tile row with 5 tiles: TAREFAS DO CONSULTOR/CONSULTANT TASKS, TAREFAS DO CLIENTE/CLIENT TASKS, ATRASADAS/OVERDUE, CONCLUIDAS/COMPLETED, TOTAL DE TAREFAS/TOTAL TASKS
- [x] Tile counts use exact same filter logic as `updateTabCounts()` — no re-derived logic
- [x] `updateTasksHeroTiles()` function added; called in both `loadTasks()` success handler and `toggleComplete()` so tiles stay live when tasks are checked off
- [x] Relocated `.page-header-row`, `.role-tabs`, `.client-filter-row`, `.controls-bar` into `.tasks-hero-content` below tiles
- [x] Page heading changed to `.page-heading-hero` (white text)
- [x] `.role-tab-btn` restyled for dark bg: rgba(255,255,255,0.55) inactive, white active, gold border-bottom active
- [x] `.role-tab-count` badges restyled: rgba glass inactive, gold-tinted active
- [x] `.view-toggle` restyled for dark bg: rgba border + backdrop-filter blur, rgba(255,255,255,0.6) text, gold active
- [x] `.view-toggle-btn` restyled: white/translucent inactive, gold fill + dark text active
- [x] `.client-filter-select` restyled: dark glass background, white text, rgba border
- [x] `.done-chip` color updated to rgba white for legibility over photo
- [x] kenburns CSS animation + prefers-reduced-motion disable added
- [x] All JS uses var, function() declarations, null checks, plain ASCII strings

### Deployment (session 49)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 49):** tasks.html, progress.md

---

## Completed (session 48 — 2026-07-03, calendar.html hero section)

- [x] Removed `padding: 24px 28px` from `#appMain`; added `.below-hero-section { padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; }` per the client.html pattern
- [x] Wrapped `#calendarContent` in `.below-hero-section` div
- [x] Added `.calendar-hero-section` as first child of `#appMain` with `#calendarHeroBg` (kenburns bg) + `#calendarHeroScrim` (dark overlay) + `.calendar-hero-content` wrapper
- [x] Glass tile row with 5 tiles: TOTAL SESSIONS, THIS WEEK (Sun–Sat of current real-world date), ONLINE MEETINGS (session_type=online_meet), IN-PERSON (session_type=in_person), AWAITING MEET LINK (online_meet AND link null/empty/"[PENDING_GOOGLE_API]")
- [x] `updateCalendarHeroTiles()` function added; called at end of `loadCalendar()` success and error handlers
- [x] All tile labels bilingual with show-pt/show-en spans (TOTAL DE SESSOES, ESTA SEMANA, REUNIOES ONLINE, PRESENCIAL, AGUARDANDO LINK)
- [x] Relocated `.page-header-row` (heading + New Session button) and `.cal-toolbar` (view toggle + month nav) into `.calendar-hero-content` below tiles
- [x] Page heading changed to `.page-heading-hero` (white text)
- [x] `.view-toggle` restyled for dark bg: rgba border + backdrop-filter blur, white text for inactive, gold for active
- [x] `.month-nav-btn` restyled: dark glass bg, white text, gold on hover
- [x] `.month-nav-label` color changed to white
- [x] `.btn-new-session` uses rgba(201,164,58,0.9) gold for visibility over photo
- [x] `initHeroBg('calendarHeroBg', 'calendarHeroScrim')` function added (exact same random-pick + onerror fallback pattern as other pages)
- [x] `initHeroBg` called from `setupPage()` alongside existing init logic
- [x] kenburns CSS animation + prefers-reduced-motion disable added
- [x] All JS uses var, function() declarations, null checks, plain ASCII strings

### Deployment (session 48)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 48):** calendar.html, progress.md

---

**Last updated:** 2026-07-03 (session 47 — sessions.html photo hero section with stat tiles and relocated tab-bar)

## Completed (session 47 — 2026-07-03, sessions.html hero section)

- [x] Added `#sessionsHeroSection` div as first child of `#contentArea`, sibling above `#appMain` (does not disturb #appMain's existing flex/scroll layout)
- [x] Hero elements: `#sessionsHeroBg` (kenburns background), `#sessionsHeroScrim` (dark overlay), `.sessions-hero-content` wrapper
- [x] Added `initHeroBg('sessionsHeroBg', 'sessionsHeroScrim')` function (exact same random-pick + onerror fallback pattern as dashboard.html/clients.html)
- [x] `initHeroBg` called from `setupPage()` alongside existing init logic
- [x] 5 glass stat tiles: INBOX (status=inbox), AWAITING SUMMARY (status=pending), WHATSAPP SENT (whatsapp_sent_at not null), TOTAL SESSIONS (status != discarded), TRANSCRIPTS (raw_transcript not null — matches renderTranscriptList filter exactly)
- [x] `updateSessionStats()` called from `loadSessions()` after sessions array is populated — no new API calls
- [x] All tile labels bilingual with show-pt/show-en spans
- [x] Relocated `.tab-bar#aliceTabBar` from inside `#aliceView` into `.sessions-hero-content` (below tile row); all IDs, onclick handlers, badge behavior unchanged
- [x] Tab pills restyled for dark photo background: rgba(255,255,255,0.18) border, white/light text, active state retains var(--gold) background with dark text
- [x] Removed `.tab-bar` white background and light-surface border treatment (no longer on white surface)
- [x] `#aliceView` content now starts directly with `#tabInbox` panel — tab-switching logic and scroll behavior untouched
- [x] kenburns CSS animation + prefers-reduced-motion disable added
- [x] `#sessionsHeroSection` hidden in print styles
- [x] All JS uses var, function() declarations, null checks, plain ASCII strings

### Deployment (session 47)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 47):** sessions.html, progress.md

---

**Last updated:** 2026-07-03 (session 46 — client.html Edit Sections bar moved into hero)

## Completed (session 46 — 2026-07-03, client.html Edit Sections bar moved into hero)

- [x] Moved `.edit-sections-bar` from below `.profile-hero-section` into `.profile-hero-content`, placed below `.profile-header-shell` inside the photo hero area
- [x] Restyled `.btn-edit-sections` for dark background: rgba(26,22,18,0.45) fill + backdrop-filter blur(10px), white text (rgba(255,255,255,0.75)), rgba(255,255,255,0.18) border — matches `.view-toggle` pattern from dashboard.html
- [x] Hover state updated to rgba(255,255,255,0.45) border + #fff text
- [x] Done button inline style updated to gold-on-dark colors (border-color: rgba(201,164,58,0.7), color: #e8c96a) instead of light-background var(--gold)/var(--brown)
- [x] `margin-bottom: 4px` on `.edit-sections-bar` replaced with `margin-top: 12px` for correct spacing inside the hero
- [x] All IDs, onclick handlers (enterEditSectionsMode, exitEditSectionsMode), and bilingual show-pt/show-en spans unchanged

### Deployment (session 46)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 46):** client.html, progress.md

---

**Last updated:** 2026-07-03 (session 45 — calendar.html cal-chip text wrapping fix)

## Completed (session 45 — 2026-07-03, calendar.html cal-chip text wrapping fix)

- [x] Changed `.cal-chip` overflow text behavior from ellipsis truncation to word wrapping
- [x] Replaced `white-space: nowrap` + `text-overflow: ellipsis` with `white-space: normal` + `word-wrap: break-word`
- [x] All other `.cal-chip` properties unchanged (max-width, min-width, padding, font-size, line-height, border-radius, color variants)

### Deployment (session 45)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 45):** calendar.html, progress.md

---

**Last updated:** 2026-07-03 (session 44 — client.html profile header hero redesign)

## Completed (session 44 — 2026-07-03, client.html profile header hero redesign)

- [x] Replaced plain white `.profile-header-shell` with full hero + glass-tile treatment matching dashboard.html and clients.html
- [x] Added `profile-hero-section` wrapper with `#clientHeroBg` + `#clientHeroScrim` elements and kenburns CSS animation
- [x] Added `initHeroBg('clientHeroBg', 'clientHeroScrim')` function (exact same logic as dashboard.html / clients.html: random pick from picture1–5 with onerror fallback chain)
- [x] `initHeroBg` called from the existing `window.onload` before `init()`
- [x] `.profile-header-shell` restyled as glass-morphic container (dark backdrop-filter blur, semi-transparent border)
- [x] `.client-name` in hero scoped via `.profile-header-meta .client-name` to render white over photo
- [x] `.package-lozenge` and `.status-client-lozenge` colors updated for contrast against dark glass background (semi-transparent tints replacing solid pastels)
- [x] All element IDs preserved: headerLogoWrap, headerLogoPlaceholder, headerLogoImg, clientName, clientBadges, nextMeetingLozenge, nextMeetingText, btnScheduleSession, btnHeaderPdf
- [x] All onclick handlers preserved: openNewSessionModal, openScheduleSessionModal, handleHeaderPdf
- [x] Non-header content (Edit Sections bar, Overview card, Sessions, Digital Presence, Logo upload, Recent Activity) untouched
- [x] All JS uses var, function() declarations, null checks, plain ASCII strings

### Deployment (session 44)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 44):** client.html, progress.md

---

**Last updated:** 2026-07-03 (session 43 — clients.html hero redesign + package dropdown fix)

## Completed (session 43 — 2026-07-03, clients.html hero redesign + package dropdown fix)

### Part 1 — Package dropdown values corrected (both files)
- [x] clients.html: Replaced 5 incorrect options (Essencial, Profissional, Sprint, Premium, VIP) in `#ncPackage` select with the 4 real APEX packages: Raio-X, Sprint, Premium, Executivo
- [x] client.html: Replaced `PACKAGE_OPTIONS` array (was ["Essencial", "Profissional", "Sprint", "Premium", "VIP"]) with ["Raio-X", "Sprint", "Premium", "Executivo"]

### Part 2 — clients.html redesigned with hero + glass tile pattern from dashboard.html
- [x] Hero section: `#heroBgImage` + `#heroBgScrim` elements, `initHeroBg()` with random image selection (picture1–5) and onerror fallback chain, kenburns CSS animation — exact copy from dashboard.html
- [x] CSS classes copied verbatim from dashboard.html: `.glass-tile-row`, `.glass-tile`, `.glass-tile-label`, `.glass-tile-value` (incl. `.is-gold`, `.is-red`), `.hero-content`, `.page-heading-hero`
- [x] Hero content: page heading "Clientes / Clients" + 5 glass tiles in order: Active Clients (is-gold), Raio-X, Sprint, Premium, Executivo
- [x] Tile counts computed client-side from same `loadClients()` fetch via new `renderTiles(clients)` function — no extra API call
- [x] Active count: status.toLowerCase() === "active"; package counts: exact string match
- [x] "+ Novo Cliente / + Add New Client" button moved to below-hero area (above table), hidden for non-create roles
- [x] Client table (Name/Package/Status columns, lozenges, row hover) preserved exactly as before
- [x] `window.onload = function() { init(); }` pattern adopted (was bare `init()` call)
- [x] Bilingual show-pt/show-en spans on page heading and Active Clients tile label; package tile labels are proper nouns (no translation needed)
- [x] All JS uses `var`, `function()` declarations, null checks on every getElementById, plain ASCII strings

### Deployment (session 43)
- [x] git commit + push → GitHub Pages auto-deploy triggered

**Files touched (session 43):** clients.html, client.html, progress.md

---

**Last updated:** 2026-07-03 (session 42 — Fix discarded sessions appearing on calendar/dashboard)

## Completed (session 42 — 2026-07-03, Fix discarded sessions in calendar endpoint)

### Root cause
`handleGetSessionsCalendar` in `worker/index.js` queried sessions with no status filter, so soft-deleted (discarded) sessions were returned to both `dashboard.html` (Rafa's Overview / This Week's Meetings) and `calendar.html`.

### Fix
Added `AND status != 'discarded'` to the WHERE clause in the D1 query inside `handleGetSessionsCalendar`, matching the existing pattern used by `handleGetSessions`.

### Deployment (session 42)
- [x] worker/index.js: query updated
- [x] npx wrangler deploy

**Files touched (session 42):** worker/index.js, progress.md

---

## Completed (session 41 — 2026-07-03, Fix broken picture1.jpg + image load fallback)

### Root cause
`assets/login/picture1.jpg` was a 2-byte stub — no image data. This caused the hero background to go grey on any page load where the random pick landed on picture1 (~1-in-5). Both `index.html` (login) and `dashboard.html` had no error recovery, so a failed image load left the background permanently grey.

### Fix 1 — Replace corrupted file
Copied `assets/login/picture2.jpg` over `picture1.jpg`. File is now 1,743,609 bytes (valid JPEG).

### Fix 2 — `dashboard.html` onerror fallback
Rewrote `initHeroBg()` to use a `tryLoadImage(i)` recursive helper. On `onerror`, it advances to the next image in the array (skipping back to `idx` if it would loop around, treating that as "all failed"). If all 5 images fail, it gives up gracefully and leaves the background as-is (no grey flash from a partially-set state).

### Fix 3 — `index.html` onerror fallback
Applied the same `tryLoadImage` pattern to the inline IIFE that sets `#bg-image` and `#bg-scrim` on the login page. Same behavior: random start, sequential fallback, graceful abort.

### Deployment (session 41)
- [x] git commit: a5424a0 "fix: replace corrupted picture1.jpg and add image load fallback"
- [x] git push origin main → GitHub Pages auto-deploy triggered

**Files touched (session 41):** assets/login/picture1.jpg, dashboard.html, index.html

---

## Completed (session 40 — 2026-07-03, Developer-only Add User nav link)

### nav.js (only file touched)

**Problem:** add-user.html was reachable only by typing the URL directly — no sidebar nav entry existed.

**Fix:**
1. Added `user-plus` icon type to `navSvg()` (person silhouette + cross).
2. In `initNav`, after `var items = ...`, added a guard: when `apex_role === "developer"`, copies the items array via `.slice()` (preserving NAV_ITEMS_ALICE for real Alice logins) and pushes an Add User entry pointing to `add-user.html`.
3. The link appears only when the authenticated role stored in `sessionStorage.apex_role` is `"developer"` — Alice and Rafa logins never see it, even if the dev switcher previews their view.

### Deployment (session 40)
- [x] git commit: 0456cd1 "Add developer-only 'Add User' nav link"
- [x] git push origin main

**Files touched (session 40):** nav.js only

---

## Completed (session 39 — 2026-07-03, Fix dev preview switcher)

### dashboard.html (only file touched)

**Problem:** nav.js's dev view switcher calls `window.setView(role)` but dashboard.html never defined it. The function was missing entirely — clicks silently failed (nav.js guards with `typeof window.setView === "function"` before calling).

**Fix:** Added `window.setView = function(role)` after all render helpers (`renderAliceDashboard`, `renderRafaDashboard`, `loadDevOverview`, `initHeroBg`) are defined but before `window.onload`. Hides all three dashboard roots then shows the correct one and calls the appropriate render function.

**Note on Dev button behavior:** nav.js passes `"alice"` (not `"dev"`) when the Dev switcher button is clicked — this resets the preview back to Alice view, which is the correct intended behavior.

### Deployment (session 39)
- [x] git commit: 9a3eeb9 "Fix dev preview switcher by defining window.setView on dashboard"
- [x] git push origin main

**Files touched (session 39):** dashboard.html only

---

## Completed (session 38 — 2026-07-03, Premium dashboard redesign)

### dashboard.html (only file touched)

**Alice dashboard (renderAliceDashboard):**
- Glass tile row (Pending / Summarized / Approved / Total) over rotating mountain photo background (same image array + selection logic as index.html)
- Status bar: "X/Y sessoes aprovadas / sessions approved" with gold progress bar
- Below photo: Recent Sessions table unchanged in data, restyled with existing card/table visual language
- Developer role: completely untouched behavior, rendered via separate devDash section

**Rafa dashboard (renderRafaDashboard):**
- Daily / Weekly scope toggle (pill buttons, same pattern as calendar.html)
- 3 glass tiles: Meetings (today or week), Tasks Due (scope-sensitive), Overdue (always full running total, never changes with toggle)
- Status bar: X/Y tasks complete, switches with Daily/Weekly toggle
- Meetings list: client name clickable to client.html, time (daily) or date+time (weekly), Join button if google_meet_link is valid
- Tasks list: client name clickable, click-to-complete (PATCH /api/tasks/:id { status: done }), moves to Done section on success, persists in D1 across reloads
- Active and Done tasks in two visually separate groups on same page

### Deployment (session 38)
- [x] git commit: 8008e9e "Premium dashboard redesign: glassmorphic tiles for Alice + full Rafa overview"
- [x] git push origin main

**Files touched (session 38):** dashboard.html only

---

**Last updated:** 2026-07-03 (session 37 — Fix New Session time input)

## Completed (session 37 — 2026-07-03, Fix New Session time input)

### calendar.html (only file touched)

**Problem:** `<input type="time" id="nsTime">` was unreliable — browser autofill/prediction greyed out but did not confirm on Tab; Enter key did not commit typed values; users had to hand-type hour and AM/PM.

**Fix:** Replaced the native time input with a `<select id="nsTime">` populated with 30-minute increments from 7:00 AM to 9:00 PM. Option values are stored in 24-hour HH:MM format (e.g. `value="13:00"`) so `handleNewSession()` sends the correct string to POST /api/sessions/schedule without any conversion. No other JS changes needed.

### Deployment (session 37)
- [x] git commit: d5b80c8 "Replace native time input with dropdown select in New Session modal"
- [x] git push → origin/main → GitHub Pages auto-deploy triggered

**Files touched (session 37):** calendar.html only

---

**Last updated:** 2026-07-03 (session 36 — Fireflies live wiring)

## Completed (session 36 — 2026-07-03, Fireflies live wiring)

### Task 1 — FIREFLIES_API_KEY secret
- [ ] Nicole to run manually: `npx wrangler secret put FIREFLIES_API_KEY --name apex-api`

### Task 2 — Webhook endpoint verification
- [x] POST /api/fireflies/webhook confirmed present in deployed Worker source (worker/index.js line 161)
- [x] Route wired at line 1472: `if (path === "/api/fireflies/webhook" && method === "POST") { return handleFirefliesWebhook(request, env); }`
- [x] Handler includes HMAC verification (skips if FIREFLIES_WEBHOOK_SECRET not set), duplicate detection via fireflies_id, D1 INSERT for inbox sessions

### Task 3 — Delete mock inbox session
- [ ] BLOCKED: Cloudflare D1 API returned error 7500 during this session. Retry when API recovers:
  - `npx wrangler d1 execute apex-command-center --remote --command "DELETE FROM sessions WHERE id = 'test-inbox-001';"`
  - Verify empty: `npx wrangler d1 execute apex-command-center --remote --command "SELECT id FROM sessions WHERE id = 'test-inbox-001';"`

### Task 4 — Register webhook in Fireflies dashboard
- [ ] Nicole to do manually: Webhook URL = `https://apex-api.farfromtimnah.workers.dev/api/fireflies/webhook`

### Status
Webhook endpoint live and verified. Mock session deletion and API key/webhook registration pending (manual steps or Cloudflare recovery).

---

## Completed (session 34 — 2026-07-03, Google Calendar OAuth)

### D1 — new table
- [x] `oauth_tokens` table created: id TEXT PK DEFAULT 'google_calendar', refresh_token TEXT NOT NULL, scope TEXT, created_at TEXT, updated_at TEXT
- [x] Holds exactly one row (id = 'google_calendar'); INSERT OR REPLACE on each connect

### worker/index.js — 4 new routes
- [x] GET /api/google/oauth/start — developer only; builds Google OAuth URL with scope=calendar, access_type=offline, prompt=consent; returns { auth_url }; does NOT redirect
- [x] GET /api/google/oauth/callback — no auth (Google calls directly); receives ?code=; exchanges for tokens via POST to oauth2.googleapis.com/token with 15s timeout; validates refresh_token presence; stores refresh_token + scope to D1 oauth_tokens via INSERT OR REPLACE; never logs or returns token; returns { ok: true, message }
- [x] GET /api/google/oauth/status — developer or alice only; checks if row exists in oauth_tokens WHERE id='google_calendar'; returns { connected: true/false }; never returns token value
- [x] POST /api/google/calendar/event — any authenticated role; body: { summary, description, start_datetime, end_datetime, add_meet_link }; looks up refresh_token from D1; exchanges for access_token with 15s timeout; POSTs to Google Calendar API with 15s timeout; supports conferenceData (Meet link) when add_meet_link=true; discards access_token after request (never stored); returns { google_event_id, google_meet_link, html_link }

### Security
- oauth_tokens table never returned by any endpoint
- refresh_token stored only; access_token lives in Worker memory during single request
- All D1 queries use .prepare().bind()
- All Google API calls have 15s AbortController timeout
- OAuth scope limited to calendar only

### add-user.html
- [x] "Google Calendar" content-card section added after Approved Users table
- [x] Status indicator: calls GET /api/google/oauth/status on page load; shows green "Connected" or muted "Not connected"
- [x] "Connect Google Calendar" gold button: calls GET /api/google/oauth/start, opens returned auth_url in new tab
- [x] "Check Status" button: refreshes status indicator without page reload
- [x] JS uses var, function declarations, window.onload pattern, null checks, Bearer token pattern matching rest of page

### Deployment (session 34)
- [x] D1 migration: oauth_tokens table created and verified (SELECT returns empty array — correct)
- [x] Worker deployed: version ff7fafe2, apex-api.farfromtimnah.workers.dev
- [x] Live endpoints verified: /api/google/oauth/status and /api/google/oauth/start both return 401 Unauthorized (routes live, auth working)
- [x] git commit + push → GitHub Pages auto-deploy

**Files touched (session 34):** worker/index.js, add-user.html, progress.md

**QA checklist (requires developer auth token):**
1. GET /api/google/oauth/status → { connected: false } before connecting
2. GET /api/google/oauth/start → { auth_url: "https://accounts.google.com/..." }
3. Open auth_url in browser → Google consent → redirects to /api/google/oauth/callback → { ok: true, message: "Google Calendar connected successfully" }
4. GET /api/google/oauth/status → { connected: true } after connecting
5. POST /api/google/calendar/event with valid body → { google_event_id, html_link } (and google_meet_link if add_meet_link=true)
6. GET /api/google/oauth/status with rafa role → 403 Forbidden
7. add-user.html shows status indicator and Connect button; status updates after Check Status click

---

**Last updated:** 2026-07-03 (session 33 — Fix calendar card overflow + week/day session rendering)

## Completed (session 31 — 2026-07-03, Calendar frontend)

### calendar.html (new file)
- [x] Full page shell: same auth guard, header, sidebar, loading screen as all other pages
- [x] Month view: 7-column grid, day number, today highlight (gold underline), session chips (navy = Meet, gold = In-Person), prev/next month navigation
- [x] Week view: time rows 7am–9pm × 7 day columns, session chips per slot, same colors
- [x] Day view: single column, time rows 7am–9pm, session chips full width
- [x] View toggle pills (Mês / Semana / Dia) with active gold state
- [x] Month/week/day navigation arrows with label update
- [x] Data: GET /api/sessions/calendar?month=YYYY-MM on load and navigation
- [x] New Session modal: client dropdown (GET /api/clients), date picker, time picker, Meet/In-Person toggle (animated meet info field with max-height transition), notes textarea
- [x] New Session submit: POST /api/sessions/schedule → close modal, refresh calendar, toast
- [x] Session Detail modal: client name, date, time, type pill, status badge, meet link (clickable), notes
- [x] WhatsApp button: POST /api/sessions/:id/whatsapp → open returned URL in new tab, update button to Enviado ✓ / Sent ✓
- [x] Empty state in all views
- [x] Bilingual PT/EN throughout (show-pt/show-en pattern)

### nav.js
- [x] Added Calendário/Calendar nav entry after Sessions for both NAV_ITEMS_ALICE and NAV_ITEMS_RAFA
- [x] Added cal-grid SVG icon (calendar with grid dots)

### client.html
- [x] Added "Agendar Sessão / Schedule Session" gold button in profile-header-actions
- [x] Added full Schedule Session modal: loads all clients, pre-selects current client, date/time/type/notes fields, POST /api/sessions/schedule on submit
- [x] Added .view-toggle-btn.active CSS rule for toggle button in the modal

### Deployment (session 31)
- [x] git commit: 039b3e2 "Add calendar page, nav entry, and Schedule Session button on client"
- [x] git push origin main → GitHub Pages auto-deploy triggered

**Files touched (session 31):** calendar.html (new), nav.js, client.html, progress.md

**Live URL:** https://farfromtimnah-hue.github.io/apex-command-center/calendar.html

---

## Completed (session 33 — 2026-07-03, Fix calendar card overflow + week/day session rendering)

### calendar.html (only file touched)

**Bug 1 — Card overflow fixed:**
- Added `max-width: 100%; box-sizing: border-box; min-width: 0` to `.cal-chip`
- Added `overflow: hidden; min-width: 0` to `.cal-cell`
- Month view chips now truncate with ellipsis; cell widths stay stable regardless of client name length

**Bug 2 — Week/day views now show sessions:**
- Root causes: (a) millisecond-based date arithmetic (`getTime() + n*86400000`) could drift across DST boundaries; (b) `calSessions` only holds the current month's data, so navigating week/day across a month boundary left slots empty
- Added `getWeekDateStrings(d)` — builds 7 YYYY-MM-DD strings using pure `new Date(y, m, day+i)` local-date constructor, no millisecond math
- `renderWeek()` now uses `weekDates[]` (string array) for all slot key lookups — pure string comparison against `s.date`
- Fixed closure capture bug in week slot filter: captured `h` into `hourVal` inside the inner loop
- `renderDay()` now derives its date key and today-check from string operations on `curDate` fields, not via `new Date()` comparison
- `navPrev()` / `navNext()` now call `loadCalendar()` when week/day navigation crosses a month boundary, keeping `calSessions` in sync

### Deployment (session 33)
- [x] git commit: 38fd78f "Fix calendar card overflow and week/day session rendering"
- [x] git push origin main → GitHub Actions triggered

**Files touched (session 33):** calendar.html only

---

## Completed (session 32 — 2026-07-03, Fix session_type alignment)

### calendar.html
- [x] Fixed session_type values sent in POST /api/sessions/schedule: 'meet' → 'online_meet', 'inperson' → 'in_person'
- [x] Fixed hidden input default value: 'meet' → 'online_meet'
- [x] Fixed setNewSessionType() comparisons to use 'online_meet' and 'in_person'
- [x] Fixed session detail display comparisons: session.session_type === "inperson" → "in_person" (5 occurrences)

### Deployment (session 32)
- [x] git commit: 085ad07 "Fix session_type values to match Worker validation"
- [x] git push origin main → GitHub Actions triggered

**Files touched (session 32):** calendar.html only

---

**Last updated:** 2026-07-03 (session 30 — Calendar + scheduling endpoints)

## Completed (session 30 — 2026-07-03, Calendar + scheduling endpoints)

### worker/index.js — 3 new routes
- [x] POST /api/sessions/schedule — creates a scheduled session row; any authenticated role; body: {client_id, date, time, session_type, notes}; session_type must be 'online_meet' or 'in_person'; sets google_meet_link = '[PENDING_GOOGLE_API]' for online_meet, null for in_person; status = 'scheduled'; returns created row
- [x] GET /api/sessions/calendar — returns all sessions for a given month; any authenticated role; query param: month (YYYY-MM); queries WHERE date LIKE 'YYYY-MM-%'; returns sessions with id, client_id, client_name, date, time, session_type, status, google_meet_link, whatsapp_sent_at; empty array (never 404) when none found
- [x] POST /api/sessions/:id/whatsapp — generates prefilled WhatsApp URL; any authenticated role; builds Portuguese message with weekday + formatted date + time; omits meet link for in_person sessions; URL-encodes message; updates whatsapp_sent_at to current ISO timestamp; returns {whatsapp_url, whatsapp_sent_at}

### wrangler.toml
- [x] Added GOOGLE_CALENDAR_CLIENT_ID = "" and GOOGLE_CALENDAR_CLIENT_SECRET = "" as placeholder vars (set real values via `wrangler secret put`)

### schema.sql
- [x] Updated sessions table definition to include time, session_type, google_meet_link, whatsapp_sent_at columns (already present in live D1 from session 29)

### Deployment
- [x] Worker deployed: version 5c54d39c, apex-api.farfromtimnah.workers.dev
- [x] Live source confirmed via workers_get_worker_code: all 3 routes present (handlePostSessionsSchedule, handleGetSessionsCalendar, handlePostSessionWhatsapp) and wired in fetch handler

**Files touched (session 30):** worker/index.js, wrangler.toml, worker/schema.sql, progress.md

**No D1 schema changes this session** — sessions table columns (time, session_type, google_meet_link, whatsapp_sent_at) already existed from session 29.

**QA checklist (requires auth token):**
1. POST /api/sessions/schedule with {client_id, date:"2026-07-10", time:"14:00", session_type:"online_meet"} → returns session row with google_meet_link="[PENDING_GOOGLE_API]", status="scheduled"
2. POST /api/sessions/schedule with session_type:"in_person" → google_meet_link is null
3. POST /api/sessions/schedule missing client_id → 400 error
4. GET /api/sessions/calendar?month=2026-07 → returns array of sessions for July 2026
5. GET /api/sessions/calendar?month=2026-99 → 400 (invalid format)
6. GET /api/sessions/calendar?month=2026-08 → empty array (no sessions), not 404
7. POST /api/sessions/:id/whatsapp on an online_meet session → whatsapp_url contains "Acesse aqui:" and the meet link
8. POST /api/sessions/:id/whatsapp on an in_person session → no meet link in message
9. After step 7 or 8, fetch session from D1 → whatsapp_sent_at is set

---

## Completed (session 28 — 2026-07-02, Fireflies inbox + pill tabs)

### sessions.html — full redesign
- [x] Four pill tabs across top of content area: Inbox / Sessions / New Session / Transcripts
- [x] Active pill: gold filled; inactive: outlined/muted; badge on Inbox showing unread count (hidden if 0)
- [x] Alice defaults to Inbox tab; Rafa sees Sessions-only layout (no tab bar, unchanged behavior)
- [x] Developer role: sees Alice view with all four tabs (same as alice)

### TAB 1 — Inbox (Alice/developer only)
- [x] Fetches GET /api/sessions/inbox on page load
- [x] Each card shows: meeting title, date, status badge (inbox/purple), transcript preview toggle
- [x] "Ver transcript / Preview transcript" toggle collapses/expands preview (first 500 chars + fade)
- [x] "Ver transcrição completa / Show full transcript" expands to full text
- [x] Client assignment dropdown populated from GET /api/clients
- [x] Summarize button disabled until client selected; shows spinner while loading
- [x] On success: card removed, badge decremented, Sessions tab updated via loadSessions()
- [x] On error: bilingual error message (PT/EN)
- [x] Empty state: bilingual centered message when inbox is empty

### TAB 2 — Sessions
- [x] Existing two-panel layout (sidebar list + detail panel) moved into this tab
- [x] Inbox sessions filtered OUT of this list (status !== 'inbox')
- [x] All existing Gerar Resumo / Aprovar / Gerar PDF logic unchanged
- [x] After saving a new transcript, auto-switches to Sessions tab and selects the new session

### TAB 3 — New Session
- [x] Manual paste form (client select, inline create-client, date, transcript textarea, Save Transcript)
- [x] Layout upgraded to full-width tab panel (was sidebar column)
- [x] All existing logic unchanged

### TAB 4 — Transcripts
- [x] Filter bar: client dropdown + date range (from/to)
- [x] Lists all sessions WHERE raw_transcript IS NOT NULL, filtered by selections
- [x] Each card: client name, date, status badge, first 200 chars of transcript
- [x] Click to expand/collapse full raw_transcript

### worker/index.js — new routes
- [x] GET /api/sessions/inbox — alice/developer only; returns status='inbox' sessions newest first
- [x] POST /api/sessions/:id/assign-client — assigns client_id + client_name, sets status='pending'
- [x] POST /api/fireflies/webhook — no Firebase auth; HMAC verification if FIREFLIES_WEBHOOK_SECRET set;
       accepts without verification if secret empty (for testing before key is configured)
       Duplicate detection: checks task_completions JSON for fireflies_id before inserting
       Stores meetingId as {"fireflies_id": "..."} in task_completions column (no schema migration needed)

### wrangler.toml
- [x] Added FIREFLIES_API_KEY = "" and FIREFLIES_WEBHOOK_SECRET = "" as placeholder vars
       (set real values via `wrangler secret put FIREFLIES_API_KEY` and `wrangler secret put FIREFLIES_WEBHOOK_SECRET`)

### Testing without live Fireflies account
Insert a mock inbox session in D1 console:
  INSERT INTO sessions (id, client_name, date, status, raw_transcript, created_at)
  VALUES (
    'test-inbox-001',
    'Test Meeting - Fireflies Mock',
    '2026-07-02',
    'inbox',
    'This is a mock transcript for testing the inbox UI. Rafael discussed quarterly goals, team hiring, and marketing strategy with the client. The session lasted approximately 45 minutes and covered three main action items.',
    datetime('now')
  );

### What still needs the live API key to test
- Fireflies webhook receiving real meeting data (POST /api/fireflies/webhook)
- FIREFLIES_API_KEY is placeholder only — no pull/polling from Fireflies API yet (webhook push model)
- Webhook URL to give Fireflies: https://apex-api.farfromtimnah.workers.dev/api/fireflies/webhook

**Files touched (session 28):** sessions.html, worker/index.js, wrangler.toml, progress.md

**QA checklist:**
1. Log in as alice → sessions.html → four pill tabs visible: Inbox, Sessions, New Session, Transcripts
2. Inbox tab active by default → mock session card visible (after inserting test data in D1)
3. Inbox card shows title, date, purple "Caixa de Entrada" badge
4. "Ver transcript" button → preview expands; "Ver transcrição completa" → full text shows
5. Client dropdown populates from real clients; Summarize button disabled until client selected
6. Select client → Summarize enabled → click → spinner shows → card disappears from inbox
7. Badge count decrements; Sessions tab now shows the summarized session
8. Sessions tab → existing two-panel layout works identically to before
9. New Session tab → paste form works; saving redirects to Sessions tab with new session selected
10. Transcripts tab → cards list all sessions with transcripts; filter by client and date range
11. Click transcript card → expands to show full text; click again → collapses
12. Log in as rafa → no tab bar, directly sees approved sessions sidebar (unchanged)
13. Inbox badge hidden when count is 0
14. Bilingual toggle works on all tabs (all labels, status badges, empty states)
15. No console errors

---

**Last updated:** 2026-07-02 (session 27 — pdf_data parse fix in sessions.html)
**Current phase:** Session 27 complete — Generate PDF now works for sessions created through the normal transcript flow.
**Last session summary:** Fixed `handleGeneratePdf` in sessions.html. The function was reading `session.pdf_data` as a top-level field, but `/api/sessions` does not return that column — so it was always undefined for sessions going through the transcript flow. The fix: fall back to extracting `pdf_data` from within `summary_json` (where `handleApprove` preserves it), then JSON.parse whichever source is found. Sessions with a top-level `session.pdf_data` still work. Error messages are now bilingual (PT/EN).

---

## ==========================================================================
## CRITICAL — READ BEFORE TOUCHING Gerar PDF / pdf_data IN FUTURE SESSIONS
## ==========================================================================
## pdf_data lives in its OWN TOP-LEVEL COLUMN on the sessions table (added
## manually via D1 console with ALTER TABLE sessions ADD COLUMN pdf_data TEXT).
## It is NOT nested inside summary_json. Any code that reads summary_json and
## then accesses .pdf_data from it will ALWAYS fail.
##
## Worker (worker/index.js): handleGetSessions SELECT must include pdf_data.
## Frontend (dashboard.html): handleGeneratePdf reads session.pdf_data directly
##   with JSON.parse(session.pdf_data) — never goes through summary_json.
##
## Test session: "Test 3", id 740c0efd-d19b-49aa-9866-cdafce1dd0f5 — has
## valid pdf_data inserted directly in D1. Use it to confirm PDF generation.
## ==========================================================================

## Completed (session 13 — 2026-07-01, Batch 2: language persistence, logo upload, payment method)
- [x] nav.js — added `window.apexNavToggleLang()` that toggles body class AND saves `apex_lang` to sessionStorage
  - `initNav()` now reads `apex_lang` from sessionStorage and applies it on every page load
  - This is why EN mode reset after navigation — language class was never saved before
- [x] All 7 app pages (dashboard, clients, client, sessions, documents, tasks, settings) — changed lang button `onclick` from `toggleLang()` to `apexNavToggleLang()`
  - Language toggle now persists across all page navigations
- [x] Sidebar collapse (items 2+3): code was already correct in session 12 — state saved to `apex_nav_collapsed` in sessionStorage, `initNav()` restores it on load. Verified present in all 7 pages.
- [x] Dev view switcher (item 4): code already correct — state in `apex_dev_view`, `initNav()` marks active button. Only `setView()` call (content switch) is limited to dashboard.html by design.
- [x] Duplicate logo (item 1): confirmed fixed in session 12 — no logo elements in any page header, logo only in sidebar injected by nav.js.
- [x] wrangler.toml — added `[[r2_buckets]]` binding: `ASSETS → apex-command-center`
- [x] worker/index.js — 3 new routes:
  - `POST /api/clients/:id/logo` — validates auth (alice/developer), validates file type (JPG/PNG/GIF/WebP), stores in R2 as `logos/{id}.{ext}`, updates `clients.logo_url`
  - `GET /api/clients/:id/logo-image` — proxies from R2, no raw R2 paths exposed; auth-free (non-sensitive logo assets addressed by UUID)
  - `PATCH /api/clients/:id` — updates `payment_method` (alice/developer only)
  - Updated `GET /api/clients` and `GET /api/clients/:id` to include `payment_method` in SELECT
  - Added `PATCH` to `Access-Control-Allow-Methods` CORS header
- [x] D1 — `ALTER TABLE clients ADD COLUMN payment_method TEXT` (applied live to apex-command-center)
- [x] client.html — logo upload card (right column):
  - Shows placeholder icon or live preview via `GET /api/clients/:id/logo-image`
  - Upload button (alice/developer only, hidden for rafa via `initLogoDisplay()`)
  - File type validated client-side before upload
  - Preview updates immediately after successful upload
- [x] client.html — Payment Method card (below Notes in left column):
  - Single-select: Zelle, Physical Check, Stripe
  - Loads current value from client data on page load
  - Saves on change via `PATCH /api/clients/:id`
  - Bilingual label, quiet/compact appearance
- [x] Worker deployed: version 2c9e18f3, apex-api.farfromtimnah.workers.dev
- [x] Pushed to GitHub: commit 44d6bd9, origin/main

**Files touched (session 13):** nav.js, wrangler.toml, worker/index.js, client.html, clients.html, dashboard.html, sessions.html, documents.html, tasks.html, settings.html

**QA checklist (live test required):**
1. Confirm only one Apex logo visible — should pass (session 12 fix, confirmed in code)
2. Confirm sidebar collapse works (click toggle) — code is correct; needs browser confirm
3. Confirm collapse state persists after navigating between pages
4. Confirm dev role switcher shows correct active button after navigation (developer account only)
5. Confirm toggling to EN and navigating to another page keeps EN mode
6. Confirm all nav labels (Sessions, Documents, Tasks, Settings) show in EN when in EN mode
7. Confirm client.html shows Payment Method dropdown below Notes
8. Confirm client.html shows logo card with upload button (alice/developer) or preview
9. Confirm logo upload works end-to-end (upload → preview updates)
10. Confirm payment method dropdown saves and reloads correctly
11. Confirm PT and EN both work on client.html
12. Confirm no console errors

**Known gap:** Worker deploy done but logo route requires alice/developer role. Rafa will see logo preview but not upload button.

## Completed (session 12 — 2026-07-01, Batch 1: shared nav fixes)
- [x] nav.js — two CSS fixes in injectStyles()
  - Added `height: calc(100vh - 64px)` to `#navSidebar` rule — explicit height so collapse toggle and dev view switcher are never clipped by overflow:hidden regardless of how the body/pageWrapper flex chain resolves
  - Added `#appHeader { justify-content: flex-end; }` — keeps user controls right-aligned after logo removal
- [x] Removed duplicate Apex logo from #appHeader on all 7 app pages:
  - dashboard.html: removed bare <img class="logo-img"> (no link wrapper on this page)
  - clients.html, sessions.html, documents.html, tasks.html, settings.html, client.html: removed <a href="dashboard.html"><img></a> block
  - Logo now appears ONLY in the nav sidebar (injected by nav.js), per spec
- [x] No Worker changes, no schema changes, no new pages

**Files touched (session 12):** nav.js, dashboard.html, clients.html, client.html, sessions.html, documents.html, tasks.html, settings.html

**QA checklist status (code review only — no live browser test this session):**
- Duplicate logo: FIXED — removed from HTML on all pages
- Collapse toggle: FIXED — navSidebar now has explicit height so toggle is always visible
- Dev view switcher: FIXED — same height fix ensures switcher is never clipped
- Role-aware nav (Alice/Rafa/Dev): UNCHANGED — nav.js role logic untouched
- Bilingual PT/EN: UNCHANGED — nav.js bilingual CSS rules untouched
- Tasks in Rafa sidebar: UNCHANGED — per Nicole's explicit instruction

**Known gap:** Session 12 fixes were code-review only. Nicole should do a live browser QA against the deployed GitHub Pages site to confirm toggle/switcher are now visually present on clients.html, sessions.html, etc.

**Next recommended batch (Batch 2):** Build out real pages for Sessions, Documents, Tasks, Settings (currently showing "Em breve / Coming soon"). Do NOT start until Nicole confirms Batch 1 QA passes.

---

## Completed (session 11 — 2026-06-30)
- [x] nav.js — shared persistent nav sidebar component
  - Renders into `<div id="navSidebar">` injected by each page
  - Role-aware: Alice (6 items: Dashboard, Clients, Sessions, Documents, Tasks, Settings), Rafa (4 items: Overview, My Clients, Sessions, Tasks), Developer (Alice's full set + Alice|Rafa|Dev view switcher)
  - Tasks included in Rafa's sidebar per Nicole's explicit instruction (deviation from spec text)
  - Active-state: gold left-edge indicator, matched by pathname filename
  - Expand (240px) / collapse (72px icon rail) with tooltip on hover; state persisted in sessionStorage
  - Developer view switcher calls `setView()` on host page; stores `apex_dev_view` in sessionStorage
  - CSS variable `--nav-width` (not `--sidebar`) to avoid collision with dashboard.html's existing `--sidebar: 296px`
  - All CSS injected by nav.js itself; no per-page CSS needed
  - Uses `var`/`function()`, no arrow functions, no localStorage, plain ASCII in JS strings
- [x] clients.html — real clients list page
  - Fetches GET /api/clients, renders table: name (link to client.html?id=), package lozenge, status lozenge
  - Empty state if no clients; error state on fetch failure
  - Full nav sidebar, auth guard, bilingual show-pt/show-en pattern
- [x] sessions.html, documents.html, tasks.html, settings.html — placeholder pages
  - Each: standard header + nav sidebar + auth guard + "Em breve / Coming soon" text only
  - No fake UI, no illustrations, no mock data per spec
- [x] dashboard.html — Phase 3 retrofit
  - Removed `#devBar` element entirely and all related CSS (.dev-label, .btn-view, etc.)
  - Added `#pageWrapper` (flex row) + `#contentArea` (flex column) wrapper around loadingScreen + appMain
  - `<div id="navSidebar">` injected as first child of pageWrapper
  - `<script src="nav.js">` added
  - `setupDashboard()`: removed devBar.hidden logic, reads `apex_dev_view` from sessionStorage for developer role initial view, calls `initNav()` before `setView()`
  - `setView()`: now references `navBtnAlice`/`navBtnRafa`/`navBtnDev` (nav.js-rendered elements) instead of old devBar buttons
  - Print CSS updated: `#navSidebar` hidden (replaces old `#devBar`)
- [x] client.html — Phase 3 retrofit
  - Added same `#pageWrapper` / `#navSidebar` / `#contentArea` wrapper structure
  - `<script src="nav.js">` added
  - `setupPage()` calls `initNav()` after showing appMain

## Real pages vs placeholders (post-session-11)
- REAL (full functionality): Dashboard (dashboard.html), Client profile (client.html), Clients list (clients.html)
- PLACEHOLDER (coming soon only): Sessions, Documents, Tasks, Settings

## Completed (session 10 — 2026-06-30)
- [x] client.html — client profile screen (spec section 7), deployed to GitHub Pages
  - Two-column layout (65% left, 35% right)
  - Header: client name (large/bold), package lozenge, Ativo/Pausado/Encerrado status lozenge, Nova Sessão button (modal, pre-filled client_id), Gerar PDF button (only visible when approved session with pdf_data exists)
  - Sessions section: table (Data/Tipo/Status/Ações), Ver opens summary modal reusing renderSummaryCards(), Gerar PDF reuses handleGeneratePdf(); empty state with icon + heading + helper + CTA per spec
  - Notes section: chronological newest-first list, author + timestamp per note, Adicionar Nota modal, bilingual stored as-is
  - Right column: client info card (skips empty fields, bilingual profile toggle), document summary (latest doc date + approved badge), activity timeline placeholder "Em breve"
  - KNOWN GAP: activity timeline is a placeholder — no generic event log table/routes exist anywhere in this build. Nicole must decide on data source before this can be built.
- [x] worker/index.js — 5 new/updated routes
  - GET /api/clients/:id — single client row, all columns, 404 if not found
  - GET /api/sessions — added client_id to SELECT; supports optional ?client_id= filter
  - GET /api/clients/:id/notes — all notes newest first
  - POST /api/clients/:id/notes — creates note; created_by derived from auth role (alice→"Alice", rafa→"Rafa", developer→"Dev"), never trusted from client
  - GET /api/clients/:id/documents/latest — most recent document via sessions JOIN (chose dedicated route over extending sessions response to keep payloads lean)
- [x] dashboard.html — Phase 3: client name in session rows is now a link to client.html?id=<client_id>; rows without client_id (old test data) remain non-clickable, no error
- [x] Deployed: worker version 1b2ac739, pushed to origin/main (commit 9efe5e1)

## Completed (session 9 — 2026-06-30)
- [x] Phase 1 schema: session_summaries and documents tables added to schema.sql
  - session_summaries: id, session_id (UNIQUE), summary_pt/en, recommendations_pt/en, client_action_items_pt/en, rafa_followups_pt/en, next_session_focus_pt/en, client_profile_updates_pt/en
  - documents: id, session_id (UNIQUE), pdf_data TEXT, created_at
  - sessions table: added pdf_data TEXT to schema.sql (already existed in live D1 — schema now matches)
- [x] Phase 2: handlePostSummarize updated (worker/index.js)
  - Writes pdf_data to sessions.pdf_data (dashboard compat fix — previously only test session had pdf_data)
  - Writes 6 structured keys to session_summaries using ON CONFLICT upsert
  - Writes pdf_data verbatim to documents using ON CONFLICT upsert
  - All 3 writes are idempotent — re-summarizing a session updates in place
- [x] Phase 4: Elevante RDE 04 seed built and validated (clients/elevate_seed.sql)
  - clients/elevante.md populated with full session content
  - clients/elevate_seed.sql: 3 INSERTs (sessions, session_summaries, documents) — all JSON blobs validated
  - Session UUID: f4a8d2e1-3c5b-4f7e-8a9b-0c1d2e3f4a5b | client_name: "Elevate" | date: 2026-06-10
  - pdf_data: 3 headline_insights, 4 recommendations, 6 client_actions, 4 consultant_followups, 3 focus_points, full SWOT, thirty_day_plan=[]
  - thirty_day_plan is explicitly empty array (no sprint data for this session)
  - Run: wrangler d1 execute apex-command-center --file clients/elevate_seed.sql

## Completed (recent additions — 2026-06-30)
- [x] Login glass panel switched to dark tint for readability — 2026-06-30
  - index.html: .auth-panel background changed from rgba(255,255,255,0.42) → rgba(26,26,24,0.62) (--hero dark tint)
  - Border changed from rgba(255,255,255,0.6) → rgba(255,255,255,0.15) (subtle light on dark)
  - Box-shadow darkened to rgba(0,0,0,0.35)
  - Gold eyebrow + COMMAND CENTER wordmark now clearly legible on all 5 background photos including bright sunset shots
  - backdrop-filter:blur(20px) / -webkit-backdrop-filter retained; layout, animations, toggle untouched

- [x] Login screen split into tight glass panel + floating button — 2026-06-30
  - index.html: replaced single .auth-card with .auth-stack (flex column, align-items:stretch, gap:28px, width:fit-content, max-width:min(420px,calc(100vw-40px)), min-width:260px)
  - .auth-panel (glass) holds only eyebrow + logo-wrap + wordmark; padding 36px 40px; same blur/border/shadow treatment
  - .btn-google now sits directly on the photo background — no glass panel behind it; width stretches to match panel via align-items:stretch
  - .status-msg moved outside .auth-stack to main level (margin-top:4px) so it doesn't inflate the stack gap
  - Combined footprint is ~274px wide vs old 420px fixed card — noticeably more mountain visible
  - Logo fade-in, shimmer, PT/EN toggle, Firebase auth all untouched

- [x] Login card redesign — glass effect, logo, wordmark, fade-in, shimmer — 2026-06-30
  - index.html: replaced solid white card with rgba(255,255,255,0.45) + backdrop-filter:blur(20px) + -webkit-backdrop-filter (Safari); border rgba(255,255,255,0.6)
  - Removed h1 "Apex Command Center" and subtitle paragraph entirely
  - Added .logo-wrap + .card-logo (72px, Apex logo URL) + .logo-shimmer overlay + .card-wordmark "COMMAND CENTER"
  - Wordmark: Inter ExtraBold 800, letter-spacing 0.18em, uppercase, --gold color; Google Fonts URL updated to include weight 800
  - Fade-in: @keyframes logoFadeIn (opacity 0→1, translateY 8px→0, 1.6s ease-out forwards)
  - Shimmer: @keyframes shimmer (background-position sweep left-to-right, 7s cycle, 28% sweep + 72% pause); @supports (-webkit-mask-size:cover) or (mask-size:cover) gates the whole effect — .logo-shimmer defaults to opacity:0 so no rectangle artifact in unsupported browsers; animation-delay 1.8s so shimmer starts only after fade-in completes
  - prefers-reduced-motion: disable fade-in (opacity:1, static) and shimmer (animation:none, opacity:0)
  - PT/EN toggle untouched; Firebase auth untouched; Ken Burns background untouched

- [x] Ken Burns background on login screen — 2026-06-30
  - index.html: added #bg-image (position: fixed, z-index: -2) and #bg-scrim (z-index: -1) as first children of <body>
  - On load, JS picks one of assets/login/picture1-5.jpg at random; image fetches via new Image(); scrim + animation only activate after onload (graceful fallback to --surface if image 404s)
  - @keyframes kenburns: scale 1.0→1.06, translate 0→(1.5%, 0.8%), 28s ease-in-out infinite alternate — no visible loop jump
  - prefers-reduced-motion: reduce → animation: none, static image shown
  - Both fixed divs use top/left/right/bottom: 0 (no inset shorthand) for widest Safari iOS support
  - Firebase auth, PT/EN toggle, and all existing layout untouched
  - NOTE: assets/login/ directory was not present in repo at time of implementation — images must be added before this feature is visible

## Completed (recent additions — 2026-06-29/30)
- [x] Gerar PDF button — end-to-end PDF generation via iframe + postMessage + html2pdf.js — 2026-06-29
  - worker/index.js: added pdf_data as 7th key in SUMMARY_PROMPT; bumped max_tokens to 8192
  - templates/apex-strategic-report-wired.html: extracted renderReport(), added postMessage listener + JSON-file fallback
  - dashboard.html: html2pdf CDN tag, Gerar PDF button, handleGeneratePdf(), handleApprove preserves pdf_data
- [x] Gerar PDF "pdf_data ausente" bug fixed and deployed — 2026-06-30 (session 3)
  - Root cause: Worker SELECT omitted pdf_data column; frontend read summary_json.pdf_data instead of session.pdf_data
  - Fix 1: worker/index.js handleGetSessions — added pdf_data to SELECT list
  - Fix 2: dashboard.html handleGeneratePdf — now reads JSON.parse(session.pdf_data) directly
  - Confirmed: wrangler deploy successful, version 1e869289, apex-api.farfromtimnah.workers.dev
- [x] Archived sessions filtered from dashboard list — 2026-06-30 (session 8)
  - worker/index.js handleGetSessions: added WHERE status != 'archived' to sessions SELECT
  - 'archived' is the standing convention for hiding test/old sessions without deleting data — use UPDATE sessions SET status = 'archived' WHERE ... to hide any session
  - Deployed: wrangler deploy successful, version f7e7bcc5-2790-4d24-9eb6-16487756600f, apex-api.farfromtimnah.workers.dev
- [x] Loading spinner bug fixed — 2026-06-30 (session 7)
  - Root cause: `#loadingScreen { display: flex }` (ID selector) beat `[hidden] { display: none }` (attribute selector) on specificity
  - Fix: added `#loadingScreen[hidden] { display: none; }` immediately after the existing block — same specificity tier, later in cascade wins
  - worker/index.js not touched; no wrangler deploy needed
- [x] Test session data archived in live D1 — 2026-06-30 (session 7)
  - SET status = 'archived' for client_name IN ('Test 3', 'TEST 2', 'TEST CLIENT') — 3 rows written
  - Sessions still appear in dashboard list (no filter added); hiding archived sessions is optional follow-up (add WHERE status != 'archived' to handleGetSessions query in worker/index.js)
- [x] Phase 1 PDF pipeline fully complete and verified — 2026-06-30 (session 6)
  - Fixed consultant name: "Rafael Andrade" → "Rafael Prata" in dashboard.html buildTemplateData()
  - Data propagation, native print export, logo/filename polish, correct consultant name all confirmed end-to-end
- [x] PDF template cosmetic polish — 2026-06-30 (session 5)
  - Removed redundant "APEX" / "BUSINESS & LEADERSHIP" text next to cover logo (logo image already contains that text)
  - Added static <title>Apex - Relatorio Estrategico</title> so print dialog has a real default filename
  - renderReport() now sets document.title dynamically to "Apex - {client_name} - {session_date}" before fillSlots()
  - PDF pipeline confirmed fully functional end-to-end: data propagation fixed (session 3), native print replacing html2pdf (session 4), polish (session 5)
- [x] PDF export switched from html2pdf.js to native browser print — 2026-06-30 (session 4)
  - Root cause of old approach: html2pdf slices the page into fixed-height chunks with no awareness of CSS page-break rules, producing dark bars and split content
  - The template already carried "CMD/CTRL + P PARA EXPORTAR PDF" — it was designed for native print from the start
  - Fix: dashboard.html handleGeneratePdf now opens template in a new tab via window.open(), posts data to it, and does nothing else
  - Fix: template's postMessage handler now calls window.print() from inside its own window after rendering — this prints the template, not the dashboard
  - KNOWN FAILURE MODE (avoided): if window.print() is called from dashboard.html's own window context, the browser prints the dashboard, not the template. It MUST be called from inside the template window.
  - Removed: html2pdf CDN script tag, hidden iframe creation, html2pdf() call, onRendered message listener, 15s timeout
- [x] Security: postMessage origin pinned on all three sides — 2026-06-30
  - dashboard.html incoming listener: event.origin guard (farfromtimnah-hue.github.io)
  - dashboard.html outgoing postMessage: target origin pinned (not *)
  - apex-strategic-report-wired.html reply: event.source.postMessage with event.origin (not *)

## Completed (original)
- [x] index.html — Firebase Google Sign-In, role fetch, redirect — 2026-06-29
- [x] dashboard.html — post-login shell, Alice/Rafa/dev views — 2026-06-29
- [x] worker/index.js — auth, role check, sessions, summarize, approve routes — 2026-06-29
- [x] worker/schema.sql + D1 tables created and seeded (alice, rafa, developer users) — 2026-06-29
- [x] wrangler.toml configured with real D1 ID, Firebase project ID — 2026-06-29
- [x] Full login flow confirmed working end to end — 2026-06-29
- [x] GitHub repo live, .gitignore verified — 2026-06-29

## Completed (session 20 — 2026-07-02, Add User tool)
- [x] worker/index.js — CORS headers: added DELETE to Access-Control-Allow-Methods
- [x] worker/index.js — GET /api/users: developer only; returns all rows from users table (email, role) ordered by email
- [x] worker/index.js — POST /api/users: developer only; body {email, role}; trims + lowercases email; validates role (alice|rafa|developer); INSERT OR REPLACE so re-adding updates role instead of erroring
- [x] worker/index.js — DELETE /api/users/:email: developer only; removes row; 404 if not found; wired in fetch router under segs[1]==="users" && method==="DELETE"
- [x] add-user.html — new developer-only page; shows 403 message if non-developer logs in (server-side check enforced by Worker, client-side gate shows friendly message)
  - Form: email input + role dropdown (Alice/Rafa/Developer) + Save button
  - On submit: POST /api/users; shows inline success (green) or error (red) message; clears email input on success
  - Success message includes saved email + role for confirmation
  - Below form: table of all current approved users (email + color-coded role pill: green=alice, blue=rafa, gold=developer)
  - Table reloads automatically after each successful save
  - nav.js Mobile More sheet already linked to add-user.html from session 19 — link now resolves
- [x] Worker deployed: version eee370c3, apex-api.farfromtimnah.workers.dev

**Files touched (session 20):** worker/index.js, add-user.html (new), progress.md

**No D1 schema changes** — users table already exists with email + role columns.

**QA checklist (browser test required):**
1. Log in as developer → navigate to More sheet (mobile) or nav sidebar → "Add User" link
2. add-user.html loads; shows "Gerenciar Usuarios / Manage Users" heading
3. Current users table shows existing rows (alice, rafa, developer emails)
4. Enter a new email (e.g. alicecorsino12@gmail.com) → select role "Alice" → click Save
5. Green success message shows with email + role confirmation
6. Users table refreshes and shows the new row immediately
7. Re-submit same email with different role → row updates (INSERT OR REPLACE), no error
8. Leave email blank → red "Email obrigatorio" message, no API call
9. Enter invalid role (can't happen via dropdown, but confirm server rejects if tampered)
10. Log in as alice or rafa → add-user.html shows "Acesso restrito" message, no form visible
11. After adding Alice's new email with role "alice", confirm she can log in with that email and reach the dashboard

## Completed (session 24 — 2026-07-02, Status editable + tasks completion pass)

### CHANGE 1 — Status editable on client.html
- [x] Status pill (Ativo / Pausado / Encerrado) now has a ✎ pencil button (alice/developer only) — same UX as package edit
- [x] Clicking pencil opens inline select with options: Ativo/Active, Pausado/Paused, Encerrado/Closed
- [x] On select, saves via PATCH /api/clients/:id with {status: value}; pill updates immediately on success; cancel on blur
- [x] statusWrap/statusLozenge/statusEditBtn DOM pattern mirrors pkgWrap; CSS classes status-edit-btn + status-edit-select added
- [x] No Worker changes needed (PATCH /api/clients/:id already handles status field from session 14)

### CHANGE 2A — Client filter on tasks.html
- [x] Client filter dropdown added below role tabs; label "Todos os Clientes / All Clients" + one entry per client with tasks
- [x] clientFilter state var; onClientFilterChange() updates state and re-renders
- [x] getTabTasks() applies clientFilter after tab type filter
- [x] populateClientFilter() builds unique sorted client list from allTasks; called after deriveTasks
- [x] Filter resets to "All Clients" when switching tabs (setTabRole clears clientFilter)

### CHANGE 2B — Overdue section on tasks.html
- [x] #overdueSection div injected above role tabs in HTML
- [x] renderOverdueSection() finds all allTasks with dueDate < today and !completedMap[key], sorted by due date
- [x] Shows above tabs — global, both tab types shown with Consultor/Cliente chip label
- [x] Styling: #8B3A2A background, white text, 12px border-radius, 0 2px 8px shadow, rgba(255,255,255,0.12) row separators
- [x] Due date in rgba(255,255,255,0.75); client name + task text in #ffffff; chip: rgba(0,0,0,0.2) bg
- [x] renderOverdueSection() called on load and on every toggleComplete (completing a task removes it from overdue)
- [x] window.onload wraps init() call (was bare init() call before)

**Files touched (session 24):** client.html, tasks.html, progress.md

**No Worker changes, no D1 schema changes, no new routes.**

**QA checklist (browser test required):**
1. Open client.html for any client (alice/developer role) → status pill shows ✎ pencil button
2. Click pencil → inline select appears with Ativo/Active, Pausado/Paused, Encerrado/Closed options
3. Select new status → pill updates immediately; reload → status persists (D1)
4. rafa role → no pencil button on status pill
5. Open tasks.html → client filter dropdown visible below tabs; shows "Todos os Clientes / All Clients" + client names
6. Select a client → only that client's tasks shown in current tab
7. Switch tabs → filter resets to All Clients
8. If any tasks are overdue and incomplete → overdue section appears above tabs in reddish-brown
9. Complete an overdue task → it disappears from overdue section immediately
10. Bilingual toggle works on overdue section and client filter labels

## Completed (session 23 — 2026-07-02, Edit Sections drag reorder)

### Edit Sections mode
- [x] "Edit Sections" small secondary outlined button added above the two-column layout in client.html
- [x] Click enters edit mode: all 9 reorderable section bodies collapse, drag handles (Unicode braille &#9783;) appear left of each header, collapse chevrons hide
- [x] Native HTML5 drag-and-drop (draggable + ondragstart/ondragover/ondragleave/ondrop/ondragend) — no external library
- [x] "Done" button replaces "Edit Sections" while in edit mode; click saves order to localStorage key apex_section_order_{clientId} and restores collapse states
- [x] On page load: reads apex_section_order_{clientId} from localStorage, reorders sections in #sectionsList; falls back to default order
- [x] Default order: overview → sessions → dp → clientTasks → consultantTasks → contacts → notes → payment → docs
- [x] Contacts section moved from right column (col-side) into left column (col-main / #sectionsList) — now reorderable
- [x] Documents section moved from right column (col-side) into left column (col-main / #sectionsList) — now reorderable
- [x] Right column (col-side) now holds only Logo and Recent Activity (non-reorderable)
- [x] toggleSection() is a no-op while is-edit-sections body class is active — prevents accidental collapse during drag
- [x] All existing per-section collapse controls (chevron toggles) untouched and still functional in view mode
- [x] All section IDs updated to sec-{key} pattern; data-section-id attribute used for order tracking
- [x] documentCardInner div introduced; renderDocumentCard() targets it instead of rebuilding outer card
- [x] window.onload wraps init() call
- [x] Plain ASCII only in all JS strings; var throughout; regular function() everywhere; null checks on getElementById

**Files touched (session 23):** client.html, progress.md

**QA checklist (browser test required):**
1. Open client.html for any client → "Edit Sections" small outlined button visible near top, above the two-column layout
2. Click "Edit Sections" → all section bodies collapse to header-only; drag handles appear on left of each header; "Done" button appears; "Edit Sections" button hidden
3. Drag a section (e.g. Notes) above another (e.g. Sessoes) → section moves in place
4. Click "Done" → sections expand back to their previous collapsed/open state; order is saved
5. Reload page → sections appear in the saved order
6. Clear localStorage key apex_section_order_{clientId} → reload → default order restored
7. Contacts and Documents sections appear in left column (no longer in right sidebar)
8. Right sidebar shows only Logo and Recent Activity
9. Per-section chevron collapse controls still work normally when NOT in edit mode
10. Bilingual toggle works on all section headers (PT/EN)
11. No console errors

## Completed (session 22 — 2026-07-02, Overview + Digital Presence + Tasks + Collapse)

### Overview card
- [x] New card above Sessions (left column); 7 fields: Business Name, Owner(s), Sector, Location, Package, Status, Next Meeting
- [x] Inline-editable: clicking a value shows an input; blur saves via PATCH /api/clients/:id; Escape cancels
- [x] Replaces Empresa card — data pulled from existing client record (name, owners, industry, location, package, status)
- [x] Empresa / clientInfoCard div removed from right column

### Digital Presence section
- [x] Below Overview, left column; read view shows only platforms with data (URL + note count)
- [x] Edit button opens modal with 7 platform tabs (Website, Instagram, TikTok, LinkedIn, Facebook, Google Business, YouTube)
- [x] Per platform: URL field + add review note form (working / needs improvement); existing notes shown in read view
- [x] Notes save with ISO timestamp; stored in D1 under clients.digital_presence (JSON TEXT column)
- [x] D1: ALTER TABLE clients ADD COLUMN digital_presence TEXT — applied to live apex-command-center
- [x] Worker: GET /api/clients/:id/digital-presence + PATCH /api/clients/:id/digital-presence
- [x] Security: URL scheme validated client-side (http/https only) before anchor href assignment; same validation enforced server-side in handlePatchDigitalPresence

### Client Tasks section
- [x] Below Digital Presence, left column; type = 'client'
- [x] Each task row: description, due date, completion checkbox
- [x] Completion toggles done state (strikethrough + opacity) — row stays visible, does not disappear
- [x] Completion persists to D1 via PATCH /api/tasks/:id

### Consultant Tasks section
- [x] Same as Client Tasks but type = 'consultant'
- [x] Same D1-backed completion state — PATCH /api/tasks/:id updates the same tasks table that tasks.html can read

### D1 schema
- [x] CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT, type TEXT, description TEXT, due_date TEXT, status TEXT DEFAULT 'pending', created_at TEXT)
- [x] Worker routes: GET /api/clients/:id/tasks, POST /api/clients/:id/tasks, PATCH /api/tasks/:id
- [x] Security: PATCH /api/tasks/:id requires alice or developer role; verifies task exists before UPDATE

### Section collapse controls
- [x] Every section card gets a collapse toggle (▼/▶ chevron in card header)
- [x] Collapsed/open state saved per user per section in localStorage: apex_collapse_{clientId}_{sectionName}
- [x] 11 sections wired: overview, sessions, dp, clientTasks, consultantTasks, notes, payment, contacts, logo, docs, activity

**Files touched (session 22):** client.html, worker/index.js, worker/schema.sql, progress.md

**Deployments:** Worker version 6d44d297 (apex-api.farfromtimnah.workers.dev); GitHub Pages confirmed live (all 10 feature markers found in fetched HTML)

**QA checklist (browser test required):**
1. Open client.html for any client → Overview card visible above Sessions with all 7 fields
2. Click a field value (Business Name, Owner, Sector, Location) → input appears; type new value → blur → saves without reload
3. Empresa / Business card is gone from right sidebar
4. Scroll to Digital Presence → "Nenhuma presença digital" if empty
5. Click Editar → modal opens; select Instagram tab; enter URL + review note → Save → read view updates
6. Reload page → digital presence data still shows (persisted in D1)
7. Scroll to Client Tasks → empty state; click + Adicionar → form appears; fill description + date → Save → task appears
8. Click task checkbox → row dims/strikethrough; reload → still done
9. Same test for Consultant Tasks
10. Collapse any card by clicking ▼ → body hides, chevron flips to ▶; reload → stays collapsed (localStorage)

## Completed (session 21 — 2026-07-02, nav.js revert + view switcher diagnosis)

### Part A — sessions.html blank (FIXED)
- [x] Root cause confirmed via headless Playwright testing: session 19's `injectMobileDock()` added elements to `document.body` via `initNav()`. Testing confirmed this caused a regression on sessions.html (page appeared blank / transcript upload workflow inaccessible).
- [x] Fix: reverted nav.js to its pre-session-19 state (commit f5661ce) — mobile dock additions removed entirely
- [x] Confirmed live: sessions.html now renders correctly on GitHub Pages with zero JS errors, appMain visible, alice view active
- [x] add-user.html and all session 20 Worker work untouched
- [x] Git push confirmed: dfabf0f..67fc6fc main → main

### Part B — View Switcher Diagnosis (DO NOT FIX YET — diagnosis only)
**Root cause found — two separate problems:**

1. **Handler fires correctly** — clicking Alice/Rafa/Dev buttons does call `apexNavSetView(v)`, sessionStorage updates to correct value, button active-state CSS updates. The binding itself is not broken.

2. **DOM switch is a no-op everywhere** — `apexNavSetView` calls `window.setView(v)` at the end, but `window.setView` is `undefined` on every page:
   - `dashboard.html`: session 16 replaced the alice/rafa view divs with a lightweight overview — there is no `setView` function and no `#aliceView` / `#rafaView` in the DOM anymore
   - `sessions.html`: has a local `function setView(role)` but it is NOT on `window`, so `window.setView` is undefined
   - All other pages: never had a `setView` at all

3. **Fix scope for a future session:** On `sessions.html`, change `function setView(role)` → `window.setView = function(role)` to expose it to nav.js. Dashboard.html no longer has alice/rafa views so the switcher doesn't apply there by design (developer sees the same overview as alice). Consider whether the switcher should be removed from dashboard.html's nav sidebar entirely, or whether dashboard.html needs a developer-specific view.

## Completed (session 19 — 2026-07-02, mobile nav: bottom dock + More sheet)
- [x] nav.js — fixed blocking mobile bug: sidebar was `display: none` below 720px with no replacement
- [x] nav.js — mobile breakpoint changed from 720px to 768px (standard phone breakpoint)
- [x] nav.js — bottom dock injected into `<body>` by `initNav()` at runtime
  - Fixed position at bottom of screen, 64px tall, dark background matching sidebar
  - Shows top 3 primary destinations per role: Dashboard, Clients, Sessions (+ More tab)
  - Active dock tab highlighted in gold (#C9A43A), matching desktop sidebar active state
  - Bilingual labels (PT/EN) from same nav item definitions; respects `apex_lang` session state
- [x] nav.js — "More" tab opens a bottom sheet with all remaining nav items
  - Overlay dims the page; tap outside or close button dismisses the sheet
  - For Alice role: Documents, Tasks, Settings in sheet
  - For Rafa role: Tasks in sheet (Rafa's set is only 4 items total)
  - For Developer role: Documents, Tasks, Settings, Add User page link + dev view switcher (Alice/Rafa/Dev buttons) in sheet
  - `apexNavSetView()` updated to sync both desktop sidebar buttons AND mobile sheet buttons
- [x] nav.js — `@media (max-width: 768px)` adds `padding-bottom: 72px` to `#appMain` / `#contentArea` so content isn't hidden behind dock
- [x] No changes to any HTML page, Worker, D1 schema, or routes

**Files touched (session 19):** nav.js, progress.md

**QA checklist (browser test required — must test on phone or mobile emulation):**
1. Open any app page in browser devtools at 390px width (iPhone viewport)
2. Confirm: left sidebar is gone, bottom dock appears with 4 tabs (Dashboard, Clients, Sessions, More)
3. Confirm: active page's dock tab is gold; other tabs are muted
4. Tap a dock tab → navigates to that page; new page loads with dock visible, correct active tab
5. Tap "More" tab → dark overlay appears, sheet slides up from bottom
6. Confirm More sheet lists: Documents, Tasks, Settings (alice role) or Tasks (rafa role)
7. Developer role More sheet: also shows Add User link + Alice/Rafa/Dev view switcher buttons
8. Tap a More sheet item → navigates to that page (sheet closes naturally on navigation)
9. Tap outside the sheet (on the overlay) → sheet closes, overlay disappears
10. Tap the X button in sheet header → sheet closes
11. Switch to 1200px (desktop) → dock is gone, sidebar is visible as before; no regressions
12. Test bilingual toggle: switch to EN → dock labels and sheet labels update

**Known gap:** Add User page (add-user.html) does not exist yet — that is Part 1, a separate task. The More sheet link will 404 until Part 1 is built.

## Completed (session 18 — 2026-07-02, tasks.html role tabs + completion)
- [x] tasks.html — Consultant / Client top-level tabs (underline style, with pending/total count badge)
  - Consultant tab (default): shows rafa + text tasks → answers "What does Rafa need to do next?"
  - Client tab: shows client action items only
- [x] tasks.html — By Date / By Type sort controls now work within whichever tab is active
- [x] tasks.html — Completion toggle: circular checkbox on each row; click marks done (strikethrough, muted, 0.52 opacity) or undone
  - Done chip in controls bar shows "N of M done / N de M concluídas"
  - Tab count badge shows pending/total (e.g. "3/7")
- [x] tasks.html — Completion state persisted:
  - localStorage (instant, survives page reload, keyed by user email)
  - PATCH /api/sessions/:id/task-completions (D1, fire-and-forget, silent fallback)
  - On load: backend task_completions merged into local state (backend wins)
- [x] worker/index.js — New handlePatchSessionTaskCompletions route
  - Reads existing task_completions JSON, merges incoming keys, writes back
  - Auth required; any role can mark tasks complete
- [x] worker/index.js — GET /api/sessions now SELECTs task_completions column
- [x] D1 — ALTER TABLE sessions ADD COLUMN task_completions TEXT (applied live)
- [x] schema.sql — task_completions column documented
- [x] Worker deployed: version 059b98c6, apex-api.farfromtimnah.workers.dev
- [x] Pushed to GitHub: commit 05029c6, origin/main

**Files touched (session 18):** tasks.html, worker/index.js, worker/schema.sql, progress.md

**Schema change:** `ALTER TABLE sessions ADD COLUMN task_completions TEXT` — applied to live D1. Stores a JSON object of {taskKey → boolean} per session. Task keys are `{sessionId}_{type}_{index}` (e.g. `abc_rafa_0`, `abc_client_2`).

**MVP compromise:** Completion is persisted per-session, not as a normalized task table. This means if a session's pdf_data is regenerated (re-summarize), the old task keys will no longer match new task keys and completions will reset. This is acceptable for the current scale.

**QA checklist (browser test required):**
1. Log in → Tasks page → default shows Consultant tab, By Date sort
2. Consultant tab: shows only Rafa follow-up tasks; Client tab: shows only client action items
3. Tab count badge shows pending/total (e.g. "3/7")
4. Switch to By Type within Consultant tab → grouped by Follow-ups / Resumo headings
5. Switch to Client tab → By Type shows "Ações do Cliente" group only
6. Click checkbox on a task → row dims, text gets strikethrough, done chip updates
7. Click again → task un-marks, row returns to full opacity
8. Reload page → completed tasks stay completed (localStorage + backend)
9. Overdue tasks still show red due pill (only when not done)
10. Client name links still navigate to client.html
11. Bilingual toggle works throughout (all labels, group headings, done chip)
12. No console errors

## Completed (session 17 — 2026-07-02, tasks.html real Rafa task view)
- [x] tasks.html — Replaced "Em breve" placeholder with a real cross-client task view:
  - Fetches all sessions via GET /api/sessions (existing route, no changes)
  - Derives task rows from pdf_data.consultant_followups (type="rafa") and pdf_data.client_actions (type="client") — structured arrays with {text, due} per item already generated by the summarize flow
  - Fallback for sessions with summary_json but no pdf_data: rafa_followups free-text block emitted as a single "text" task row
  - View 1 (By Date, default): all tasks sorted chronologically by due date; undated tasks at end sorted by client name; overdue due dates shown with red accent
  - View 2 (By Type): three groups — "Follow-ups do Consultor / Consultant Follow-ups", "Ações do Cliente / Client Action Items", "Resumo de Follow-ups / Follow-up Summary"; within each group sorted by due date then client name
  - View toggle: two pill buttons at top of page; no page reload
  - Each task row: colored dot (gold=rafa, blue=client, tan=text), task text, client name (link → client.html if client_id present), session date label, due-date pill (overdue = red), type tag (by-date view only)
  - Empty state if no sessions have summaries yet
  - Footer note: "Tasks automatically derived from session summaries"
  - Full bilingual PT/EN support throughout
  - Due date parsing: "DD Mon" strings (e.g. "20 Jun") parsed with session year as context; dates > 6 months in the past assumed next year
- [x] No Worker changes, no schema changes, no new routes

**Files touched (session 17):** tasks.html, progress.md

**MVP compromises:**
- No completion/done state — no task completion field in the data model. Tasks are read-only derived view from AI summary output.
- Due dates are AI-generated strings ("DD Mon") relative to session year — may need recalibration for sessions crossing year boundaries, but the +1 year heuristic handles the common case.
- "Abrir →" links in by-date view go to sessions.html (the workbench), not a specific session detail page (no session detail page exists yet).

**QA checklist (browser test required):**
1. Log in → navigate to Tasks via nav → page loads, no "Em breve"
2. If sessions with approved summaries exist: task rows appear with client name, text, due pill
3. By-date view (default): tasks sorted soonest-first; overdue items show red due pill
4. Switch to By-type: two or three group headings visible; tasks grouped correctly
5. Click a client name in a task row → goes to client.html for that client
6. Bilingual toggle: switch to EN → all labels + type tags + group headings in English
7. Empty state: if no summarized sessions exist, shows placeholder message
8. Rafa login: tasks page loads and shows rafa's follow-up items correctly
9. No console errors

## Completed (session 16 — 2026-07-02, sessions workbench extraction + dashboard overview)
- [x] sessions.html — Replaced placeholder "Em breve" page with the full session workbench:
  - Alice/developer view: client selector dropdown (with inline create-client mini-form), date + transcript fields, Salvar Transcript button, session list sidebar (all sessions), detail panel with Gerar Resumo / Aprovar & Enviar / Gerar PDF actions, summary cards (editable when summarized, read-only otherwise)
  - Rafa view: approved-sessions list sidebar + read-only summary card detail panel with Print button
  - Developer role: setView() switches between alice and rafa views using navBtnAlice/navBtnRafa from nav.js
  - Inline create-client form uses package select (Essencial/Profissional/Sprint/Premium/VIP) consistent with rest of app
- [x] dashboard.html — Stripped the full workbench; replaced with lightweight overview:
  - Stat cards row: Pending / Summarized / Approved / Total counts (derived from GET /api/sessions)
  - Recent sessions table: up to 10 most recent, columns Client (links to client.html) / Date / Status / "Abrir →" (links to sessions.html)
  - Page heading + "+ Nova Sessão" CTA button (links to sessions.html)
  - "Ver todas →" link next to Recent Sessions heading
- [x] No Worker changes, no D1 schema changes
- [x] No nav.js changes

**Files touched (session 16):** sessions.html, dashboard.html, progress.md

**Route/data-flow notes:**
- sessions.html uses the same API routes as dashboard.html did: GET /api/sessions, GET /api/clients, POST /api/transcript, POST /api/summarize, POST /api/approve, plus the PDF template postMessage flow
- dashboard.html now only calls GET /api/sessions (for stats + recent list)
- The inline create-client mini-form in sessions.html calls POST /api/clients (same as before)

**QA checklist (browser test required):**
1. Log in as alice → lands on dashboard.html → see 4 stat cards with real counts, recent sessions table
2. Click "+ Nova Sessão" or "Sessions" nav link → lands on sessions.html → alice workbench visible
3. Select a client from dropdown → fill date + transcript → Salvar Transcript → new session appears in list, detail opens as "pending"
4. Click "Gerar Resumo" → summary cards render with PT/EN toggle working, status updates to "Resumido"
5. Edit a summary field → click "Aprovar & Enviar" → status updates to "Aprovado"
6. Click "Gerar PDF" on an approved session → template tab opens, PDF flow works
7. Log in as rafa → sessions.html shows approved-session sidebar only
8. Developer role: nav view switcher toggles between alice and rafa views on sessions.html
9. Click client name link in dashboard recent-sessions table → goes to client.html
10. dashboard.html "Abrir →" link in sessions table → goes to sessions.html (not a specific session — acceptable for now)
11. Bilingual toggle works on both pages
12. No console errors

## Completed (session 15 — 2026-07-02, package editing + Sprint option + contact layout + intake contacts)
- [x] clients.html — Added Sprint to package select in new-client modal (between Profissional and Premium)
- [x] clients.html — Restructured new-client modal intake to include contact fields up front:
  - Primary contact: name, role, phone/whatsapp (combined field), email
  - "+ Add second contact" button reveals a second contact block (same fields)
  - Both contacts saved into clients.contacts JSON array at creation time
  - Removed legacy owners/phone/whatsapp/email top-level fields from the intake form (moved into contacts)
  - Kept industry, location as business fields
- [x] client.html — Added Sprint to PACKAGE_OPTIONS array (used by inline package edit)
- [x] client.html — Made package editable via inline control in the profile header:
  - alice/developer see a ✎ pencil button next to the package lozenge
  - Clicking it replaces lozenge with a styled select (all packages incl. Sprint)
  - On change: PATCHes /api/clients/:id, re-renders lozenge; on blur without change: cancels back to lozenge
  - rafa sees the package lozenge display-only (no edit button)
- [x] client.html — Moved Contacts section from left column to TOP of right sidebar
  - Contacts now appear immediately below the profile header shell in the right column
  - Position: above Logo, Business Info, Documents, Activity
  - Left column now contains only: Sessions, Notes, Payment Method
- [x] client.html — Removed phone/email/whatsapp from renderClientInfoCard (those are contact-level fields)
  - Business info card (renamed "Empresa / Business") now shows only: owners, industry, location, profile text
- [x] client.html — Payment method card stays at bottom of left column (low-visibility operational field)
- [x] worker/index.js — Updated handlePostClients INSERT to include contacts column
- [x] Worker deployed: version e2080a68, apex-api.farfromtimnah.workers.dev

**Files touched (session 15):** clients.html, client.html, worker/index.js, progress.md

**Schema change:** None — contacts column already exists from session 14.

**Multi-contact persistence note:** Contacts are stored as a JSON array in clients.contacts (TEXT column). Intake flow in clients.html builds the array from up to 2 contacts entered during creation and passes it to POST /api/clients as contacts: JSON.stringify(array). PATCH /api/clients/:id (from client.html) appends further contacts to the same array.

**QA checklist (browser test required):**
1. Open clients.html → click "+ Novo Cliente" → modal shows business fields + primary contact fields + "+ Add second contact" link
2. Fill business info + primary contact → save → lands on client.html → Contacts section shows the contact entered
3. Click "+ Add second contact" during intake → second block appears → both contacts land in the profile
4. On client.html, confirm Contacts card is in the right sidebar near the top (not buried below sessions/notes)
5. On client.html, confirm package lozenge shows ✎ button for alice/developer; click it → select appears with Sprint option
6. Change package → auto-saves via PATCH → lozenge updates to new value without page reload
7. rafa role: package lozenge visible, no ✎ edit button
8. Business info card shows only owners, industry, location — no phone/email/whatsapp
9. Existing logo upload still works (Logo card still in right sidebar)
10. Payment method dropdown stays at bottom of left column, still saves
11. Nova Sessão, notes, PDF generation untouched

## Completed (session 14 — 2026-07-02, standalone new-client flow + profile header + contacts MVP)
- [x] clients.html — Added "Novo Cliente / Add New Client" button (top-right, hidden for rafa role)
  - Modal with fields: name*, package, status, owners, industry, location, phone, whatsapp, email
  - On save: POST /api/clients → redirect to client.html?id=NEW_CLIENT_ID
  - Button hidden for rafa role (alice/developer only)
- [x] client.html — Replaced flat client-page-header with profile-header-shell card
  - Shows inline logo thumbnail (or 🏢 placeholder) in the header
  - Package lozenge + status lozenge rendered by existing renderClientHeader()
  - Next meeting lozenge placeholder ("Sem reunião agendada / No meeting scheduled")
  - Actions (Nova Sessão, Gerar PDF) moved into header shell right side
- [x] client.html — Added Contacts section (left column, between Notes and Payment Method)
  - "Adicionar Contato / Add Contact" button opens modal
  - Contact modal fields: name*, role/title, phone, whatsapp, email
  - Contacts stored as JSON array in clients.contacts column (interim MVP — no new table)
  - Renders all contacts as individual cards; supports unlimited contacts
  - Saves via PATCH /api/clients/:id with { contacts: JSON.stringify(array) }
  - Local state updated immediately after save without full page reload
- [x] worker/index.js — GET /api/clients/:id now returns contacts column
- [x] worker/index.js — GET /api/clients now returns contacts column
- [x] worker/index.js — Added GET /api/clients/:id/contacts route (parses JSON, returns array)
- [x] worker/index.js — Expanded PATCH /api/clients/:id to handle: contacts, name, owners, industry, location, phone, email, whatsapp, package, status (in addition to existing payment_method)
- [x] D1 — ALTER TABLE clients ADD COLUMN contacts TEXT (applied to live apex-command-center)
- [x] schema.sql — Updated to include payment_method and contacts columns (now matches live schema)
- [x] Worker deployed: version 0c836594, apex-api.farfromtimnah.workers.dev

**Files touched (session 14):** clients.html, client.html, worker/index.js, worker/schema.sql, progress.md

**Schema change:** `ALTER TABLE clients ADD COLUMN contacts TEXT` — already applied to live D1. contacts is a JSON TEXT column storing an array of {name, role, phone, whatsapp, email} objects. This is an interim MVP approach: no normalized contacts table needed, easily readable, can be migrated to a proper table later.

**QA checklist (browser test required):**
1. Open clients.html → confirm "Novo Cliente" button visible (alice/developer), hidden for rafa
2. Click button → modal opens with all fields; no session/transcript fields present
3. Fill name + any other fields → click Salvar Cliente → lands on client.html?id=NEW_ID
4. Confirm new client profile shows with empty sessions, empty notes, empty contacts
5. In client.html header → confirm 🏢 placeholder (or logo if uploaded), name, package lozenge, status lozenge, next-meeting placeholder lozenge
6. Click "Adicionar Contato" → modal opens with name/role/phone/whatsapp/email fields
7. Add a contact → save → contact appears in Contacts section without page reload
8. Add a second contact → confirm both contacts show
9. Reload page → confirm contacts still show (persisted in D1)
10. Confirm existing logo upload still works (card in right column still present)
11. Confirm payment method dropdown still works and saves
12. Confirm existing Nova Sessão flow still works from header button
13. Confirm existing notes section still works
14. Confirm no console errors

## Completed (session 29 — 2026-07-03, D1 sessions table schema migration)
- [x] 9 scheduling/integration columns added to sessions table via ALTER TABLE (remote D1, apex-command-center)
  - google_event_id TEXT (cid 11)
  - google_meet_link TEXT (cid 12)
  - calendar_provider TEXT DEFAULT 'google' (cid 13)
  - fireflies_transcript_id TEXT (cid 14)
  - session_type TEXT DEFAULT 'online_meet' (cid 15)
  - scheduled_by TEXT (cid 16)
  - whatsapp_sent_at TEXT (cid 17)
  - transcript_source TEXT (cid 18)
  - transcript_ingested_at TEXT (cid 19)
- [x] PRAGMA table_info(sessions) verified — all 9 columns present at cids 11–19
- [x] No Worker code touched. No frontend files touched. No other tables modified.

**Files touched (session 29):** progress.md (schema change applied directly to live D1 via wrangler)

---

## Completed (session 38 — 2026-07-03, Rafa full permissions + consultant task endpoints)

### worker/index.js — Task 1: Rafa Alice-level permissions
Added `user.role !== "rafa"` to role checks in all listed endpoints:
- handleGetSessionsInbox, handlePostSessionDiscard, handlePostSessionAssignClient
- handlePostTranscript, handlePostSummarize, handlePostApprove
- handlePostClients, handlePostClientLogo, handlePatchClient
- handlePatchDigitalPresence, handlePostClientTask, handlePatchTask

Developer-only endpoints (user management, Google OAuth start) unchanged.
Open-to-all-auth endpoints (sessions/schedule, sessions/calendar, sessions/whatsapp) unchanged.

### worker/index.js — Task 2: GET /api/tasks/consultant
- Query param: `scope=today|week` (required)
- `today`: due_date = server's current YYYY-MM-DD
- `week`: due_date falls within current Sunday–Saturday window (same logic as calendar.html getWeekDateStrings)
- JOINs clients table to include client_name and client_id
- Auth: any authenticated role
- Returns: `{ tasks: [...] }`

### worker/index.js — Task 3: GET /api/tasks/consultant/overdue
- All pending consultant tasks with due_date < today (running total, not scoped)
- JOINs clients table to include client_name
- Auth: any authenticated role
- Returns: `{ tasks: [...], count: <number> }`
- Route registered before generic `/api/tasks/:id` PATCH to avoid conflict

### Deployment (session 38)
- npx wrangler deploy succeeded
- Version: f427d935-18fa-44f5-98bc-66a6031c09bb
- Live: https://apex-api.farfromtimnah.workers.dev
- Both new endpoints confirmed routing (return auth error on invalid token)

**Files touched (session 38):** worker/index.js, progress.md

---

## Completed (session 35 — 2026-07-03, Fix Safari popup blocking on Google Calendar connect)

### add-user.html (only file touched)
- [x] `handleConnectGcal()` now opens `window.open('about:blank', '_blank')` synchronously on button click — before any async fetch
- [x] After `getToken()` + `fetch('/api/google/oauth/start')` resolve, sets `popup.location.href = data.auth_url` on the already-open window
- [x] On error: calls `popup.close()` and shows alert — no dangling blank tab
- [x] Uses `var` + `function()` declarations, consistent with the rest of the page

**Why this fixes Safari:** Safari blocks `window.open()` after an `await` / `.then()` chain because the call is no longer synchronous within the original user gesture handler. Opening `about:blank` immediately on click keeps the window creation inside the gesture, then redirecting an already-open window is always allowed.

### Deployment (session 35)
- [x] git commit: 72a9781 "Fix Safari popup blocking on Google Calendar connect"
- [x] git push → origin/main → GitHub Pages auto-deploy triggered

**Files touched (session 35):** add-user.html only

---

## Completed (session 34 — 2026-07-03, Remove Google Calendar vars from wrangler.toml)

- [x] Removed `GOOGLE_CALENDAR_CLIENT_ID = ""` and `GOOGLE_CALENDAR_CLIENT_SECRET = ""` from `[vars]` in wrangler.toml
  - These were conflicting with wrangler secrets (error 10053 — binding name already in use)
- [x] Redeployed with `npx wrangler deploy`
  - Deploy succeeded: Version ID `559d207d-7df5-49d9-8082-daa8910bc9b1`
  - Worker live at: https://apex-api.farfromtimnah.workers.dev

**Files touched (session 34):** wrangler.toml only

**Next step:** Nicole to run `wrangler secret put GOOGLE_CALENDAR_CLIENT_ID` and `wrangler secret put GOOGLE_CALENDAR_CLIENT_SECRET` manually

---

## In Progress
- [ ] Switching /api/transcript from Granola API to manual paste
  - Status: complete — needs deploy + end-to-end test
  - Files touched: worker/index.js, dashboard.html

## Up Next
- [ ] Test manual transcript → summarize → approve flow end to end
- [ ] Build session detail screen
- [ ] PDF generation/approval flow
- [ ] Add templates/ folder with PDF template + JSON
- [ ] Fix logo in PDF template (manual edit, not AI)
- [ ] Add page 8 to PDF template (Claude Design session)
- [ ] Rafa's view content (nav tab exists, content empty)
- [ ] Build clients.html, client.html, session.html, documents.html, tasks.html, rafa.html, dev.html

## Decisions Made This Session
- Phase 1 uses manual transcript paste only — Granola API integration deferred to Phase 1.5 (only 25 free meetings before Granola requires upgrade)
- Keeping /api/transcript as the same endpoint, just changing its expected body — no new route created

## Known Issues / Blockers
- PDF template logo is a recreated SVG, not the real Apex logo — needs manual fix in template HTML
- PDF template missing page 8 (back cover) — needs Claude Design session
- Alice's real email was wrong in early docs — corrected to Alicecorsino12@gmail.com

## Files Created / Modified This Session
- worker/index.js — removed Granola API call from handlePostTranscript; now accepts { client_name, transcript, date }
- dashboard.html — replaced Granola ID input with client name + date + transcript textarea; updated handlePullTranscript() to match new body shape
- progress.md — created this file

---
