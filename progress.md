# Apex Command Center — Build Progress

**Last updated:** 2026-06-30 (session 8)
**Current phase:** Phase 1 — manual transcript intake
**Last session summary:** Filtered archived sessions from dashboard list. handleGetSessions now queries WHERE status != 'archived'. 'archived' is the standing convention for hiding test/old sessions without deleting data.

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

## Completed (recent additions — 2026-06-30)
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
