-- Schema of the live tables as they were BEFORE migrations/apex_partners_plan.sql and migrations/bs_lead_pipeline.sql.
-- Used only by scripts/test-bs-pipeline.mjs (in-memory SQLite, no network).
CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, owners TEXT, industry TEXT, location TEXT, logo_url TEXT, profile_pt TEXT, profile_en TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), package TEXT, status TEXT DEFAULT 'active', phone TEXT, email TEXT, whatsapp TEXT, payment_method TEXT, contacts TEXT, digital_presence TEXT, zoho_customer_id TEXT, zelle_qr_r2_key TEXT, stripe_payment_link TEXT, consolidated INTEGER NOT NULL DEFAULT 0, lead_stage TEXT, stage_changed_at TEXT, next_step TEXT, next_step_set_by TEXT, next_step_set_at TEXT, language TEXT DEFAULT 'pt', referral_bg_color TEXT, referral_text_color TEXT, referred_by_partner_id TEXT, source_type TEXT, source_detail TEXT, stage_changed_by TEXT, stage_change_source TEXT, package_started_at TEXT, sunbiz_doc_number TEXT, instagram_handle TEXT, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, archived_by TEXT, legal_entity_name TEXT, legal_entity_ein TEXT, legal_entity_address TEXT, legal_entity_filed_at TEXT, legal_entity_status TEXT, legal_entity_officers TEXT, legal_entity_dba TEXT, legal_entity_dba_number TEXT, duns_number TEXT, legal_entity_source TEXT, legal_entity_verified_at TEXT, hide_logo INTEGER NOT NULL DEFAULT 0, timezone TEXT, billing_type TEXT NOT NULL DEFAULT 'billable' CHECK (billing_type IN ('billable','joint_venture','pro_bono','paid_in_full','not_billed')), custom_pricing INTEGER NOT NULL DEFAULT 0, daily_log_enabled INTEGER NOT NULL DEFAULT 1, daily_log_enabled_set_by TEXT DEFAULT NULL, daily_log_enabled_set_at TEXT DEFAULT NULL, goals_enabled INTEGER NOT NULL DEFAULT 1, goals_enabled_set_by TEXT DEFAULT NULL, goals_enabled_set_at TEXT DEFAULT NULL, daily_log_before_pause INTEGER DEFAULT NULL, goals_before_pause INTEGER DEFAULT NULL, lead_temperature TEXT, invoice_card_enabled INTEGER DEFAULT 0, staff_manage INTEGER NOT NULL DEFAULT 0, link_slug TEXT, owners_json TEXT, location_state TEXT, location_city TEXT, plan TEXT NOT NULL DEFAULT 'consulting' CHECK (plan IN ('consulting','business_system')), plan_changed_at TEXT, plan_changed_by TEXT, split_mode TEXT NOT NULL DEFAULT 'split_50_50' CHECK (split_mode IN ('split_50_50','resonate_100','rafa_100')), monthly_amount_cents INTEGER CHECK (monthly_amount_cents IS NULL OR monthly_amount_cents >= 0));
CREATE TABLE apex_partners (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tipo              TEXT,                                
  contato           TEXT,
  status            TEXT NOT NULL DEFAULT 'Prospectando',
  ultima_interacao  TEXT,                                
  proxima_acao      TEXT,
 
 
 
 
 
 
 
  referral_slug     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
, hero_url TEXT);
CREATE TABLE apex_referral_hits (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE "client_logins" (
  username             TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  tracking_start       TEXT,
  password_changed_at  TEXT,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  work_schedule        TEXT,
  created_by           TEXT,
  role                 TEXT NOT NULL DEFAULT 'client',
  seller_name          TEXT,
  UNIQUE (client_id, seller_name)
);
