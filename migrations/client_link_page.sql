-- Public "link in bio" page (2026-10-10): every business gets one PUBLIC,
-- unauthenticated page the moment they complete Estimates > Settings
-- (link.html?p=<slug>) -- nothing to opt into. Linktree-style pill stack
-- plus an inline lead-capture form, no referring-person attribution (see
-- handlePostLinkPageLead; leads land with origem = "Link da bio").
--
-- Slug minted the same way gm_partners.referral_slug already is
-- (gmReferralSlug(): 14 chars, unguessable, non-enumerable) -- but this one
-- is per-CLIENT, not per-partner, since the page represents the business
-- itself, not any one salesperson or partner.

ALTER TABLE clients ADD COLUMN link_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_link_slug ON clients (link_slug);
