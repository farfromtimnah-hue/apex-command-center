# Apex Command Center — Build Progress

**Last updated:** 2026-07-02 (session 15 — package editing, Sprint option, contact layout, intake contacts)
**Current phase:** Session 14 complete — Worker deployed (version 0c836594); D1 contacts column added; pushed to GitHub pending
**Last session summary:** Added standalone Add New Client button + modal to clients.html (no session/transcript flow). New modal saves a client-only record and redirects to client.html?id=NEW_ID. Upgraded client.html header to a profile shell with inline logo thumbnail, package/status/next-meeting lozenges. Added Contacts section with multi-contact MVP (JSON array stored in clients.contacts column). Worker updated to expose contacts field everywhere and support PATCH for contacts.

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
