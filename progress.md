# Apex Command Center — Build Progress

**Last updated:** 2026-06-30 (session 11)
**Current phase:** Full nav infrastructure built (Phase 1–3 complete)
**Last session summary:** Built persistent collapsible sidebar (nav.js), 5 new pages (clients.html real, sessions/documents/tasks/settings placeholders), retrofitted dashboard.html and client.html. Removed #devBar from dashboard.html — view switcher (Alice|Rafa|Dev) now lives inside nav sidebar for developer role. Tasks deliberately added to Rafa's sidebar beyond original spec text.

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
