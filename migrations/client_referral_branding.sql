-- Referral page: per-client language default + branding (2026-07-27).
-- Additive only — three nullable columns on clients, nothing modified.
--
-- These drive referral.html, the PUBLIC unauthenticated intake form served
-- from a gm_partners.referral_slug. That page is deliberately dependency-free
-- ("must never grow a dependency on authenticated code"), so everything here
-- reaches it through the existing GET /api/referral/:slug response and nothing
-- else. All three are nullable BY DESIGN: null is the meaningful "use the
-- default" state, not missing data.

-- Starting language for referral.html: 'pt' | 'en'.
--
-- Until now the page hard-defaulted to lang-pt with a manual toggle and zero
-- server input. Apex's owners are Brazilian and comfortable in PT, but some of
-- their clients' own end customers are mostly American — a landscaping company
-- in New Mexico sending its customers a PT-first form is a real cost.
--
-- This ONLY sets the initial body class. The manual toggle button stays, so a
-- visitor can always switch; this changes the starting state, not the choice.
--
-- DEFAULT 'pt' preserves exactly today's behavior for every existing client, so
-- this migration changes nothing until a client opts in.
ALTER TABLE clients ADD COLUMN language TEXT DEFAULT 'pt';

-- Referral page branding. Hex strings like '#1a1a1d'. NULL = fall back to
-- Apex's own palette, which referral.html already hardcodes:
--   referral_bg_color   -> --header #1a1a1d
--   referral_text_color -> --gold   #C9A43A
-- Validated server-side as /^#[0-9a-fA-F]{6}$/ before storage; the page applies
-- them as CSS custom-property overrides on top of its existing palette.
ALTER TABLE clients ADD COLUMN referral_bg_color TEXT;
ALTER TABLE clients ADD COLUMN referral_text_color TEXT;

-- NOTE ON THE LOGO: no new column. The referral page reuses the EXISTING
-- clients.logo_url (an R2 key written by POST /api/clients/:id/logo) and serves
-- it through the existing GET /api/clients/:id/logo-image route. A client who
-- has already uploaded a logo in the portal gets it on their referral page for
-- free; a client with none shows their business name as text only, which is
-- today's behavior. Apex's logo is deliberately NOT used as the fallback — this
-- is the client's own branded page, and Apex's mark there would read as a bug,
-- not as a default.
