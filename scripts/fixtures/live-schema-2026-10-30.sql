-- Copy of the live D1 schema (apex-command-center), read with SELECT sql FROM sqlite_master on 2026-10-30.
-- Used by scripts/test-estimate-contract-flow.mjs. Tables and indexes only; no rows.

CREATE TABLE accounts (
  id               TEXT PRIMARY KEY,
  plaid_item_id    TEXT,
  plaid_account_id TEXT UNIQUE,
  institution      TEXT,
  name             TEXT,
  mask             TEXT,
  subtype          TEXT,
  purpose          TEXT NOT NULL CHECK (purpose IN ('business','personal')),
  balance_cents    INTEGER,
  available_cents  INTEGER,
  last_synced_at   TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE apex_club_conf_used (
  conf            TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  transaction_id  TEXT,
  used_at         TEXT NOT NULL
);
CREATE TABLE apex_club_event_dismissed (
  event_id       TEXT NOT NULL REFERENCES apex_club_events(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  dismissed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_by   TEXT,
  PRIMARY KEY (event_id, transaction_id)
);
CREATE TABLE apex_club_event_txns (
  event_id       TEXT NOT NULL REFERENCES apex_club_events(id),
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  -- 'income' = an attendee paying, 'expense' = food, books, venue.
  side           TEXT NOT NULL CHECK (side IN ('income','expense')),
  -- How many people this payment covers: 1 at $50, 2 at $75. Suggested from
  -- the amount, always confirmable, and used for the headcount rather than
  -- inferring it from the money a second time.
  people         INTEGER NOT NULL DEFAULT 1,
  confirmed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_by   TEXT,
  PRIMARY KEY (event_id, transaction_id)
);
CREATE TABLE apex_club_events (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  event_date   TEXT NOT NULL,
  -- The window transactions are drawn from. Defaults are applied in the
  -- worker, not here, so widening one event never rewrites another.
  window_start TEXT NOT NULL,
  window_end   TEXT NOT NULL,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
, price_single_cents INTEGER NOT NULL DEFAULT 5000, price_couple_cents INTEGER, flyer_r2_key TEXT, venue TEXT, start_time TEXT, speakers TEXT, registration_open INTEGER NOT NULL DEFAULT 1, calendar_clicks INTEGER NOT NULL DEFAULT 0, session_id TEXT, price_card_single_cents INTEGER, price_card_couple_cents INTEGER);
CREATE TABLE apex_club_pay_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id TEXT NOT NULL,
  stripe_link_id  TEXT,
  stripe_price_id TEXT,
  url             TEXT,
  amount_cents    INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  deactivated_at  TEXT
);
CREATE TABLE apex_club_registrations (   id            TEXT PRIMARY KEY,   event_id      TEXT NOT NULL REFERENCES apex_club_events(id),   name          TEXT NOT NULL,   phone         TEXT NOT NULL,   rsvp_state    TEXT NOT NULL DEFAULT 'going'                 CHECK (rsvp_state IN ('going','next_time')),   confirmed_at  TEXT,   attended      INTEGER,   source        TEXT NOT NULL DEFAULT 'public',   created_at    TEXT NOT NULL DEFAULT (datetime('now')), plus_one INTEGER NOT NULL DEFAULT 0, company TEXT, pay_token TEXT, paid_at TEXT, paid_cents INTEGER, paid_method TEXT, paid_ref TEXT, zelle_conf TEXT, zelle_conf_at TEXT, zelle_state TEXT, plus_one_name TEXT, plus_one_phone TEXT,   UNIQUE (event_id, phone) );
CREATE TABLE apex_club_stripe_applied (
  charge_id       TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL,
  applied_cents   INTEGER NOT NULL,
  applied_at      TEXT NOT NULL
);
CREATE TABLE apex_contract_events (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    event TEXT NOT NULL,
    actor TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE apex_contract_vendor_lines (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    label TEXT NOT NULL,
    source TEXT NOT NULL,
    recurrence TEXT NOT NULL,
    months INTEGER NOT NULL DEFAULT 1,
    vendor_cost_cents INTEGER,
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE apex_contracts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    seq INTEGER NOT NULL UNIQUE,
    number TEXT NOT NULL UNIQUE,
    package_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    data_json TEXT NOT NULL,
    total_cents INTEGER,
    public_token TEXT NOT NULL UNIQUE,
    snapshot_json TEXT,
    content_hash TEXT,
    company_signer_name TEXT,
    company_signed_at TEXT,
    company_signature_kind TEXT,
    company_signature_r2_key TEXT,
    company_signed_by TEXT,
    client_signatures_json TEXT,
    signed_at TEXT,
    sent_at TEXT,
    sent_by TEXT,
    first_viewed_at TEXT,
    last_viewed_at TEXT,
    document_id TEXT,
    terms_applied_at TEXT,
    terms_applied_by TEXT,
    void_reason TEXT,
    voided_at TEXT,
    voided_by TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, link_disabled_at TEXT);
CREATE TABLE apex_invoice_pay_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('card','ach')),
  stripe_link_id  TEXT,
  stripe_price_id TEXT,
  url             TEXT,
  amount_cents    INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  deactivated_at  TEXT
);
CREATE TABLE apex_partners (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tipo              TEXT,                                 -- free text: Contador, Ex-cliente, Parceiro comercial…
  contato           TEXT,
  status            TEXT NOT NULL DEFAULT 'Prospectando', -- Prospectando | Ativo | Inativo (same ladder as gm_partners)
  ultima_interacao  TEXT,                                 -- ISO date
  proxima_acao      TEXT,

  -- Public referral landing, mirroring gm_partners.referral_slug exactly:
  -- an unguessable slug serving an unauthenticated intake form. A submission
  -- creates a clients row with status='lead' and referred_by_partner_id set,
  -- so attribution is BY RECORD, never by matching a typed name.
  --
  -- Nullable: a partner tracked purely by hand (a lunch, a phone call) never
  -- needs a link. The slug is minted on demand, not at creation.
  referral_slug     TEXT,

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
, hero_url TEXT, plan TEXT NOT NULL DEFAULT 'consulting', start_stage TEXT);
CREATE TABLE apex_pay_link_locks (lock_key TEXT PRIMARY KEY, locked_until TEXT NOT NULL);
CREATE TABLE apex_receipt_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL
);
CREATE TABLE apex_referral_hits (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE apex_stripe_applied (
  charge_id     TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL,
  applied_cents INTEGER NOT NULL,
  applied_at    TEXT NOT NULL
);
CREATE TABLE apns_device_tokens (token TEXT PRIMARY KEY, user_email TEXT NOT NULL, environment TEXT NOT NULL DEFAULT 'production', bundle_id TEXT, device_model TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_sent_at TEXT, last_error TEXT, superseded_at TEXT);
CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY,
  transaction_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  suggested_category TEXT,
  confidence TEXT NOT NULL DEFAULT 'media' CHECK (confidence IN ('alta', 'media', 'baixa')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ignored')),
  assigned_category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE bill_emails (
  id           TEXT PRIMARY KEY,
  message_id   TEXT UNIQUE,
  received_at  TEXT,
  from_address TEXT,
  subject      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('parsed','unmatched','ignored','rejected','error')),
  bill_id      TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE bill_reminders_sent (
  bill_id    TEXT NOT NULL,
  period_key TEXT NOT NULL,
  kind       TEXT NOT NULL,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bill_id, period_key, kind)
);
CREATE TABLE bs_cost_entries (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('investment','recurring_cost','planned_cost','income')),
  description  TEXT NOT NULL,
  category     TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  frequency    TEXT NOT NULL CHECK (frequency IN ('one_time','monthly','yearly')),
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  paid_by      TEXT CHECK (paid_by IS NULL OR paid_by IN ('resonate','rafa','joint')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT,
  updated_at   TEXT,
  updated_by   TEXT,
  deleted_at   TEXT
);
CREATE TABLE bs_lead_links (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  sent_at      TEXT,
  opened_at    TEXT,
  activated_at TEXT,
  revoked_at   TEXT
);
CREATE TABLE bs_promo_items (
  id         TEXT PRIMARY KEY,
  lang       TEXT NOT NULL UNIQUE CHECK (lang IN ('pt','en')),
  title      TEXT NOT NULL DEFAULT '',
  video_url  TEXT NOT NULL DEFAULT '',
  poster_url TEXT NOT NULL DEFAULT '',
  post_text  TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  updated_by TEXT
);
CREATE TABLE business_settings (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    zelle_qr_r2_key     TEXT,
    stripe_payment_link TEXT,
    updated_at          TEXT
, club_confirm_template TEXT, zelle_pay_url TEXT, zelle_handle TEXT, client_invoice_link_enabled INTEGER DEFAULT 0, club_pay_enabled INTEGER DEFAULT 0, auto_apply_known_payers INTEGER DEFAULT 1);
CREATE TABLE categories (
  id      TEXT PRIMARY KEY,
  name_pt TEXT NOT NULL,
  name_en TEXT,
  kind    TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('income','expense','transfer'))
, sort_order INTEGER NOT NULL DEFAULT 100, archived   INTEGER NOT NULL DEFAULT 0, created_at TEXT, scope TEXT NOT NULL DEFAULT 'both'
  CHECK (scope IN ('business','personal','both')));
CREATE TABLE categorization_rules (
  id          TEXT PRIMARY KEY,
  -- The normalized merchant key this rule fires on, e.g. "HOME DEPOT".
  -- Raw BofA descriptions vary ("HOME DEPOT #6217 TAMPA FL" vs
  -- "HOME DEPOT #0412"), so matching happens on merchant_normalized, which is
  -- computed at sync time by normalizeMerchant().
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL DEFAULT 'merchant_exact'
              CHECK (match_type IN ('merchant_exact','merchant_contains')),
  -- Which account purpose this rule applies to. A rule written from a
  -- transaction inherits the scope of THAT transaction's account -- not
  -- 'both'. 'both' is reserved for rules she deliberately makes global.
  scope       TEXT NOT NULL DEFAULT 'both'
              CHECK (scope IN ('business','personal','both')),
  category_id TEXT,
  -- manual beats llm beats seed. Her override always wins and is never
  -- silently replaced by a later automatic pass. 'auto' is the transfer
  -- engine's own writer, not a categorization guess.
  source      TEXT NOT NULL DEFAULT 'manual'
              CHECK (source IN ('manual','llm','seed','auto')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);
CREATE TABLE category_budgets (
  id                  TEXT PRIMARY KEY,
  category_id         TEXT NOT NULL REFERENCES categories(id),
  monthly_amount_cents INTEGER NOT NULL,
  purpose             TEXT NOT NULL DEFAULT 'personal' CHECK (purpose IN ('business','personal')),
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  created_by          TEXT
);
CREATE TABLE client_assessments (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  assessment_type TEXT NOT NULL,             -- 'business_xray'
  status          TEXT NOT NULL DEFAULT 'not_started',
  answers_json    TEXT NOT NULL DEFAULT '{}',
  score_json      TEXT,
  activated_by    TEXT,
  activated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at      TEXT,
  completed_at    TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')), profile_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (client_id, assessment_type)
);
CREATE TABLE client_auth_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  username   TEXT NOT NULL,
  expires_at TEXT NOT NULL,                 -- ISO datetime
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE client_blocked_ranges (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  start_date TEXT NOT NULL,             -- ISO YYYY-MM-DD, inclusive
  end_date   TEXT NOT NULL,             -- ISO YYYY-MM-DD, inclusive
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE client_daily_entries (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  entry_date    TEXT NOT NULL,              -- 'YYYY-MM-DD'
  sections_json TEXT NOT NULL DEFAULT '{}',
  completed     INTEGER NOT NULL DEFAULT 0,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, entry_date)
);
CREATE TABLE client_daily_entry_edits (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, entry_date TEXT NOT NULL, section_key TEXT NOT NULL, field_key TEXT NOT NULL, old_value REAL, new_value REAL, actor TEXT NOT NULL, actor_role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE "client_documents" (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  file_url     TEXT,
  content_type TEXT,
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  visibility   TEXT NOT NULL DEFAULT 'client',
  client_visible INTEGER NOT NULL DEFAULT 1,
  preview_html TEXT,
  file_requested_at TEXT,
  file_requested_by TEXT
);
CREATE TABLE "client_field_config" (
  client_id      TEXT NOT NULL,
  indicator_key  TEXT NOT NULL,
  month_label    TEXT NOT NULL,               -- 'YYYY-MM'
  enabled        INTEGER NOT NULL DEFAULT 1,
  meta_mensal    REAL,                        -- the ACTIVE (approved) goal
  set_by         TEXT,                        -- 'client' | 'admin'
  status         TEXT NOT NULL DEFAULT 'approved',  -- 'pending' | 'approved' | 'rejected'
  proposed_value REAL,                        -- client's proposed new goal (while status='pending')
  proposed_at    TEXT,
  proposed_by    TEXT,
  decided_at     TEXT,
  decided_by     TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, indicator_key, month_label)
);
CREATE TABLE client_growth_entries (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  month_label    TEXT NOT NULL,              -- 'YYYY-MM' (e.g. '2026-07')
  growth_percent REAL NOT NULL,              -- e.g. 345 = +345%; negatives allowed
  entered_by     TEXT,
  entered_at     TEXT NOT NULL DEFAULT (datetime('now')), raw_json TEXT,
  UNIQUE (client_id, month_label)            -- one entry per client per month
);
CREATE TABLE client_login_attempts (
  id         TEXT PRIMARY KEY,
  username   TEXT,
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
CREATE TABLE client_missed_days (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  missed_date TEXT NOT NULL,                -- 'YYYY-MM-DD'
  status      TEXT NOT NULL DEFAULT 'day_off',  -- 'day_off' | 'filled_late'
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, missed_date)
);
CREATE TABLE client_notes (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE client_package_terms (
  client_id TEXT PRIMARY KEY REFERENCES clients(id),
  package_id TEXT,
  pricing_option TEXT,
  base_total REAL,
  discount_type TEXT,
  discount_value REAL,
  discount_note TEXT,
  adjusted_total REAL,
  split_mode TEXT NOT NULL DEFAULT 'even',
  installment_count INTEGER,
  installment_amount REAL,
  custom_installments TEXT,
  recurrence_unit TEXT,
  recurrence_interval INTEGER,
  recurrence_never_ends INTEGER NOT NULL DEFAULT 1,
  is_new_client INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, payments_made_before INTEGER NOT NULL DEFAULT 0, first_due_date TEXT, recurrence_id TEXT);
CREATE TABLE client_payer_aliases (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id),
  -- normalizeMerchant() output for the payer, e.g. "ZELLE PAYMENT FROM
  -- BRAZILIAN INC". Unique so one payer can never map to two clients, which
  -- would make matching ambiguous in exactly the way the engine refuses.
  payer_key   TEXT NOT NULL UNIQUE,
  -- How the alias was created: 'approved' when learned from a match Alice
  -- confirmed, 'manual' if she ever enters one directly.
  source      TEXT NOT NULL DEFAULT 'approved'
              CHECK (source IN ('approved','manual')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  TEXT
);
CREATE TABLE client_resources (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  resource_id      TEXT NOT NULL,
  assigned_at      TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by      TEXT,
  whatsapp_sent_at TEXT,                   -- null = pending, timestamp = sent (this IS the checkmark)
  sent_by          TEXT
);
CREATE TABLE client_terms (
  client_id TEXT PRIMARY KEY,
  answers_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL DEFAULT '{}',
  completed INTEGER NOT NULL DEFAULT 0,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE client_terms_claude_calls (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE client_vendor_terms (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL REFERENCES clients(id),
  vendor_id            TEXT NOT NULL REFERENCES vendors(id),
  vendor_amount_cents  INTEGER,
  markup_cents         INTEGER NOT NULL DEFAULT 0,
  label                TEXT,
  service_note         TEXT,
  recurrence_unit      TEXT CHECK (recurrence_unit IS NULL OR recurrence_unit IN ('day','week','month','year')),
  recurrence_interval  INTEGER,
  active               INTEGER NOT NULL DEFAULT 1,
  started_at           TEXT,
  ended_at             TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, vendor_id, active)
);
CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, owners TEXT, industry TEXT, location TEXT, logo_url TEXT, profile_pt TEXT, profile_en TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), package TEXT, status TEXT DEFAULT 'active', phone TEXT, email TEXT, whatsapp TEXT, payment_method TEXT, contacts TEXT, digital_presence TEXT, zoho_customer_id TEXT, zelle_qr_r2_key TEXT, stripe_payment_link TEXT, consolidated INTEGER NOT NULL DEFAULT 0, lead_stage TEXT, stage_changed_at TEXT, next_step TEXT, next_step_set_by TEXT, next_step_set_at TEXT, language TEXT DEFAULT 'pt', referral_bg_color TEXT, referral_text_color TEXT, referred_by_partner_id TEXT, source_type TEXT, source_detail TEXT, stage_changed_by TEXT, stage_change_source TEXT, package_started_at TEXT, sunbiz_doc_number TEXT, instagram_handle TEXT, archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, archived_by TEXT, legal_entity_name TEXT, legal_entity_ein TEXT, legal_entity_address TEXT, legal_entity_filed_at TEXT, legal_entity_status TEXT, legal_entity_officers TEXT, legal_entity_dba TEXT, legal_entity_dba_number TEXT, duns_number TEXT, legal_entity_source TEXT, legal_entity_verified_at TEXT, hide_logo INTEGER NOT NULL DEFAULT 0, timezone TEXT, billing_type TEXT NOT NULL DEFAULT 'billable' CHECK (billing_type IN ('billable','joint_venture','pro_bono','paid_in_full','not_billed')), custom_pricing INTEGER NOT NULL DEFAULT 0, daily_log_enabled INTEGER NOT NULL DEFAULT 1, daily_log_enabled_set_by TEXT DEFAULT NULL, daily_log_enabled_set_at TEXT DEFAULT NULL, goals_enabled INTEGER NOT NULL DEFAULT 1, goals_enabled_set_by TEXT DEFAULT NULL, goals_enabled_set_at TEXT DEFAULT NULL, daily_log_before_pause INTEGER DEFAULT NULL, goals_before_pause INTEGER DEFAULT NULL, lead_temperature TEXT, invoice_card_enabled INTEGER DEFAULT 0, staff_manage INTEGER NOT NULL DEFAULT 0, link_slug TEXT, owners_json TEXT, location_state TEXT, location_city TEXT, plan TEXT NOT NULL DEFAULT 'consulting' CHECK (plan IN ('consulting','business_system')), plan_changed_at TEXT, plan_changed_by TEXT, split_mode TEXT NOT NULL DEFAULT 'split_50_50' CHECK (split_mode IN ('split_50_50','resonate_100','rafa_100')), monthly_amount_cents INTEGER CHECK (monthly_amount_cents IS NULL OR monthly_amount_cents >= 0), bs_waitlist_at TEXT, bs_link_sent_at TEXT, bs_activated_at TEXT);
CREATE TABLE contract_admin_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT,
  set_by TEXT,
  set_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE contract_attorney_questions (
  n INTEGER NOT NULL, version INTEGER NOT NULL, group_name TEXT, text TEXT,
  PRIMARY KEY (n, version)
);
CREATE TABLE contract_clause_areas (
  id         TEXT NOT NULL, version INTEGER NOT NULL, title TEXT, intro_md TEXT, notes_md TEXT, sort_order INTEGER,
  PRIMARY KEY (id, version)
);
CREATE TABLE contract_clause_options (
  id                TEXT NOT NULL,     -- C05-B
  version           INTEGER NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'apex',   -- 'apex' or a client_id (client-private, never shared)
  area_id           TEXT NOT NULL,
  title             TEXT,
  trades            TEXT,              -- as written: "all" or a comma list
  owner_description TEXT,
  clause_text       TEXT,              -- verbatim English text with {placeholders}
  text_note         TEXT,              -- e.g. "identical to C11-A with {warranty_months_workmanship} fixed at 24."
  placeholders      TEXT,              -- the Fields line, verbatim
  pt_summary        TEXT,              -- Portuguese summary for the review only, never printed
  status            TEXT NOT NULL DEFAULT 'draft',  -- draft | approved | withdrawn
  reviewed_by_name  TEXT, reviewed_bar_number TEXT, reviewed_at TEXT,
  created_by        TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sort_order        INTEGER, origin TEXT,
  PRIMARY KEY (id, version, scope)
);
CREATE TABLE contract_clause_reviews (
  id             TEXT PRIMARY KEY,
  version        INTEGER NOT NULL,
  item_id        TEXT NOT NULL,        -- L1 or C05-B
  reviewer_email TEXT NOT NULL,
  decision       TEXT NOT NULL,        -- ok | changes
  comment        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (version, item_id, reviewer_email)
);
CREATE TABLE contract_client_settings (
  client_id            TEXT PRIMARY KEY,
  trades_json          TEXT,                 -- ["pools","tile","remodeling","hardscape","general"]
  builds_pools         INTEGER NOT NULL DEFAULT 0,
  defaults_json        TEXT,                 -- { "C01": "C01-A", ... } default option per clause area
  signers_json         TEXT,                 -- [{ "name": "...", "phone": "..." }] authorized signers besides the owner
  owner_signer_name    TEXT,                 -- the owner as printed on the signature line
  owner_signer_phone   TEXT,
  source               TEXT NOT NULL DEFAULT 'apex',  -- 'apex' | 'client' (client-private template, loaded by Apex)
  values_json          TEXT,                 -- Settings-source placeholders (work hours, notice days, warranty contact...)
  updated_by           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE contract_exclusion_checklists (
  version INTEGER NOT NULL, trade TEXT NOT NULL, items_json TEXT,
  PRIMARY KEY (version, trade)
);
CREATE TABLE contract_library_versions (
  version              INTEGER PRIMARY KEY,
  label                TEXT,
  status               TEXT NOT NULL DEFAULT 'draft',   -- draft | in_review | attorney_reviewed
  attorney_name        TEXT,
  attorney_bar_number  TEXT,
  attorney_review_date TEXT,                            -- YYYY-MM-DD
  set_by               TEXT,
  set_at               TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE contract_locked_blocks (
  id            TEXT NOT NULL,      -- L1..L7, L5-A, L5-B, L5-C
  version       INTEGER NOT NULL,
  title         TEXT,
  text          TEXT,               -- verbatim statutory / regulatory text (first quote block)
  extra_json    TEXT,               -- further verbatim quote blocks (L6 acknowledgment, safety features, barrier; L7 clause)
  trigger_rule  TEXT,
  format_rules  TEXT,
  builder_rule  TEXT,
  source_url    TEXT,
  verification_note TEXT,
  notes_md      TEXT,
  sort_order    INTEGER,
  PRIMARY KEY (id, version)
);
CREATE TABLE contract_placeholders (
  field TEXT NOT NULL, version INTEGER NOT NULL, meaning TEXT, source TEXT, sort_order INTEGER,
  PRIMARY KEY (field, version)
);
CREATE TABLE contract_review_submissions (
  id             TEXT PRIMARY KEY,
  version        INTEGER NOT NULL,
  reviewer_email TEXT NOT NULL,
  reviewer_name  TEXT,
  ok_count       INTEGER NOT NULL DEFAULT 0,
  changes_count  INTEGER NOT NULL DEFAULT 0,
  submitted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  seen_by        TEXT, seen_at TEXT
);
CREATE TABLE "doc_links" (
  slug          TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  public_token  TEXT NOT NULL,
  client_id     TEXT,
  title         TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE documents (id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, pdf_data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE finance_category_labels (
  category_account_id TEXT PRIMARY KEY,
  custom_label         TEXT NOT NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE fireflies_dismissed_transcripts (
  transcript_id TEXT PRIMARY KEY,
  dismissed_by  TEXT,
  dismissed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE "fixed_bill_payments" (
  id             TEXT PRIMARY KEY,
  bill_id        TEXT NOT NULL REFERENCES fixed_bills(id),
  period_key     TEXT NOT NULL,
  paid_at        TEXT,
  amount_cents   INTEGER,
  transaction_id TEXT REFERENCES transactions(id),
  match_type     TEXT NOT NULL DEFAULT 'manual'
                 CHECK (match_type IN ('manual', 'bank_matched', 'credit_card')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bill_id, period_key)
);
CREATE TABLE fixed_bill_statements (
  id                TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL,
  period_key        TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  due_date          TEXT NOT NULL,
  pay_url           TEXT,
  message_id        TEXT,
  differs_from_last INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(bill_id, period_key)
);
CREATE TABLE fixed_bills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  -- 1-31. A day past the end of a short month is clamped when the schedule is
  -- generated rather than stored differently, so "the 31st" keeps meaning the
  -- end of the month in February.
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  purpose      TEXT NOT NULL CHECK (purpose IN ('business','personal')),
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
, payment_method TEXT NOT NULL DEFAULT 'manual'
  CHECK (payment_method IN ('draft', 'manual')), pay_url TEXT, payee_notes TEXT, priority_rank INTEGER, payer_match_pattern TEXT, funding_source TEXT NOT NULL DEFAULT 'bank'
  CHECK (funding_source IN ('bank','credit_card','other')), cancelled_at TEXT, is_variable INTEGER NOT NULL DEFAULT 0, period_months INTEGER DEFAULT 1, period_anchor_month INTEGER);
CREATE TABLE gm_base_ouro (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT NOT NULL,
  cliente              TEXT NOT NULL,
  telefone             TEXT,
  servico_anterior     TEXT,                             -- SERVIÇO ANTERIOR / ANO (free text)
  status               TEXT NOT NULL DEFAULT 'Não contatado', -- Não contatado | Contatado | Interessado | Reativado | Sem interesse
  data_contato         TEXT,                             -- ISO date
  oferta               TEXT,                             -- OFERTA APRESENTADA
  observacoes          TEXT,
  reactivated_lead_id  TEXT REFERENCES gm_leads(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_booking_requests (
    id               TEXT PRIMARY KEY,
    token            TEXT NOT NULL UNIQUE,
    client_id        TEXT NOT NULL,
    lead_id          TEXT,
    kind             TEXT NOT NULL DEFAULT 'lead' CHECK (kind IN ('lead','general')),
    status           TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','booked','cancelled','expired')),
    answers_json     TEXT,
    slot_date        TEXT,
    slot_time        TEXT,
    end_time         TEXT,
    event_id         TEXT,
    customer_name    TEXT,
    customer_phone   TEXT,
    customer_email   TEXT,
    customer_address TEXT,
    customer_city    TEXT,
    created_by       TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at          TEXT,
    booked_at        TEXT,
    cancelled_at     TEXT
);
CREATE TABLE gm_booking_settings (
    client_id        TEXT PRIMARY KEY,
    enabled          INTEGER NOT NULL DEFAULT 0,
    public_slug      TEXT UNIQUE,
    work_days        TEXT NOT NULL DEFAULT '1,2,3,4,5',
    day_start        TEXT NOT NULL DEFAULT '09:00',
    day_end          TEXT NOT NULL DEFAULT '17:00',
    duration_min     INTEGER NOT NULL DEFAULT 60,
    min_notice_hours INTEGER NOT NULL DEFAULT 24,
    daily_cap        INTEGER NOT NULL DEFAULT 4,
    window_days      INTEGER NOT NULL DEFAULT 14,
    event_type       TEXT,
    questions_json   TEXT,
    updated_by       TEXT,
    updated_at       TEXT
);
CREATE TABLE gm_change_orders (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  job_id                TEXT NOT NULL,
  lead_id               TEXT,
  contract_id           TEXT,                 -- NULL on an estimate-only job
  number                TEXT NOT NULL,        -- CO-0001 per client
  status                TEXT NOT NULL DEFAULT 'draft',   -- draft | company_signed | sent | viewed | completed | declined | void
  description           TEXT,
  items_json            TEXT,                 -- [{pricing_id,item_name,qty,unit,rate_cents,amount_cents,kind:'add'|'remove',material_cost_cents,labor_cost_cents,other_cost_cents}]
  amount_cents          INTEGER NOT NULL DEFAULT 0,      -- signed: removals are credits
  price_before_cents    INTEGER NOT NULL DEFAULT 0,
  price_after_cents     INTEGER NOT NULL DEFAULT 0,
  schedule_days         INTEGER NOT NULL DEFAULT 0,
  payment_change        TEXT NOT NULL DEFAULT 'adjust_remaining',  -- adjust_remaining | new_step
  payment_note          TEXT,
  public_token          TEXT NOT NULL,
  company_signer_name   TEXT, company_signed_at TEXT, company_signature_kind TEXT, company_signature_r2_key TEXT, company_signed_ip TEXT, company_signed_ua TEXT,
  routed_to_name TEXT, routed_to_phone TEXT, routed_at TEXT,
  sent_at TEXT, first_viewed_at TEXT,
  homeowner_signer_name TEXT, homeowner_signed_at TEXT, homeowner_signature_kind TEXT, homeowner_signature_r2_key TEXT, homeowner_signed_ip TEXT, homeowner_signed_ua TEXT,
  snapshot_r2_key TEXT, content_hash TEXT, applied_at TEXT, applied_json TEXT,
  decline_reason TEXT, void_reason TEXT, voided_by TEXT, voided_at TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, link_disabled_at TEXT, brand_override_json TEXT DEFAULT NULL);
CREATE TABLE "gm_config" (
    client_id                TEXT PRIMARY KEY,
    servicos_json            TEXT NOT NULL DEFAULT '[]',
    vendedores_json          TEXT NOT NULL DEFAULT '[]',
    finance_categories_json  TEXT NOT NULL DEFAULT '[]',
    partner_types_json       TEXT NOT NULL DEFAULT '[]',
    cycle_months_json        TEXT NOT NULL DEFAULT '[]',
    target_margin            REAL,
    target_margin_set_by     TEXT,
    target_margin_set_at     TEXT,
    pipeline_view_threshold  INTEGER NOT NULL DEFAULT 50,
    pipeline_view_override   TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
, event_types_json TEXT);
CREATE TABLE gm_contract_custom_clauses (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  contract_id   TEXT NOT NULL,
  area_id       TEXT NOT NULL,
  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | approved_with_edits | not_approved
  revised_text  TEXT,
  attorney_name TEXT, attorney_bar_number TEXT, attorney_review_date TEXT,
  reviewed_by   TEXT, reviewed_at TEXT,
  library_option_id TEXT,                          -- the client-private option created on approval
  created_by    TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_contract_events (
  id          TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor       TEXT,
  detail_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_contract_notices (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  opened_by      TEXT, opened_role TEXT, trigger_action TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT, resolution TEXT, resolved_by TEXT,     -- contract_signed | owner_continued | job_closed
  taps_json      TEXT                                         -- [{actor, role, at, action}] seller "notify owner" taps and owner button taps
, resolution_decision TEXT, resolution_note TEXT);
CREATE TABLE gm_contract_own_template_counters (
  client_id   TEXT NOT NULL,
  day_key     TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, day_key)
);
CREATE TABLE gm_contract_own_templates (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  r2_key          TEXT NOT NULL,
  original_name   TEXT,
  page_count      INTEGER,
  mapping_json    TEXT,              -- { areas: [{key,name,excerpt|null}], unmatched: [...] }
  model           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending_review',
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  uploaded_by     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, lawyer_reviewed INTEGER);
CREATE TABLE gm_contracts (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  job_id                TEXT NOT NULL,
  lead_id               TEXT,
  estimate_ids_json     TEXT,                -- accepted estimate ids the contract incorporates
  number                TEXT NOT NULL,       -- CON-0001 per client
  revision              INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL DEFAULT 'draft',
  -- draft | awaiting_company | company_signed | sent | viewed | homeowner_signed | completed |
  -- changes_requested | declined | expired | void | superseded
  library_version       INTEGER NOT NULL DEFAULT 1,
  template_scope        TEXT NOT NULL DEFAULT 'apex',
  selections_json       TEXT,                -- { area_id: option_id }  (option may be a client-private id)
  answers_json          TEXT,                -- builder answers, placeholder -> value
  flags_json            TEXT,                -- { sold_in_home, is_pool, property_type, pool_safety_feature, property_residential_1_4 }
  rules_json            TEXT,                -- computed: which locked blocks apply and why
  contract_amount_cents INTEGER NOT NULL DEFAULT 0,
  contract_date         TEXT,
  offer_expiry_date     TEXT,
  public_token          TEXT NOT NULL,
  disclaimer_line       TEXT,                -- frozen at company signing
  has_custom_clause     INTEGER NOT NULL DEFAULT 0,
  company_signer_name   TEXT, company_signer_phone TEXT,
  company_signed_at     TEXT, company_signature_kind TEXT, company_signature_r2_key TEXT,
  company_signed_ip     TEXT, company_signed_ua TEXT,
  company_signature_voided_at TEXT, company_signature_void_reason TEXT,
  routed_to_name        TEXT, routed_to_phone TEXT, routed_at TEXT, routed_by TEXT,
  sent_at               TEXT, sent_by TEXT, first_viewed_at TEXT, last_viewed_at TEXT,
  homeowner_signer_name TEXT, homeowner_signed_at TEXT, homeowner_signature_kind TEXT, homeowner_signature_r2_key TEXT,
  homeowner_signed_ip   TEXT, homeowner_signed_ua TEXT, homeowner_initials TEXT, marketing_consent INTEGER,
  lien_signed_at        TEXT, lien_signature_kind TEXT, lien_signature_r2_key TEXT,
  pool_ack_at           TEXT, pool_docs_delivery_json TEXT,
  cancellation_deadline TEXT,                -- YYYY-MM-DD, set when the homeowner signs (L5)
  transaction_date      TEXT,
  snapshot_r2_key       TEXT, content_hash TEXT,
  change_request_text   TEXT, decline_reason TEXT,
  created_by            TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason           TEXT, voided_by TEXT, voided_at TEXT
, signed_render_r2_key TEXT, signed_render_hash TEXT, contract_price_cents INTEGER DEFAULT NULL, brand_override_json TEXT DEFAULT NULL, link_disabled_at TEXT);
CREATE TABLE gm_doc_counters (
  client_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,                 -- EST | INV | RCT | CR | REF
  next_number INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (client_id, kind)
);
CREATE TABLE gm_doc_settings (
  client_id             TEXT PRIMARY KEY,
  hero_r2_key           TEXT,                              -- doc-heroes/<clientId>.<ext>
  legal_name            TEXT,
  address               TEXT,
  phone                 TEXT,
  email                 TEXT,
  license_numbers       TEXT NOT NULL DEFAULT '[]',        -- JSON array of strings; at least one required to complete setup (§489.119)
  min_margin_pct        REAL,                              -- optional; nothing depends on it being set
  estimate_valid_days   INTEGER NOT NULL DEFAULT 30,
  default_terms_days    INTEGER NOT NULL DEFAULT 0,        -- 0 = due on receipt
  payment_methods_json  TEXT NOT NULL DEFAULT '{}',        -- {zelle:"detail", check:"payable to", cash:"", money_order:"", bank_transfer:"instructions", card_link:"https://...", other:"text"} — only TICKED methods are present
  late_fee_annual_pct   REAL,                              -- NULL = no penalty; never above 18 (§687.03)
  late_fee_grace_days   INTEGER,
  schedule_presets_json TEXT NOT NULL DEFAULT '[]',        -- JSON [{name, steps:[{label, pct}]}]; steps total exactly 100, or [] for "Custom"
  estimate_message      TEXT,                              -- send-message templates; placeholders {customer_first_name} {job_name} {business_name} {seller_name} {link}
  invoice_message       TEXT,
  receipt_message       TEXT,
  setup_completed_at    TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by            TEXT
, brand_primary TEXT, brand_accent  TEXT, contract_message TEXT, contract_route_message TEXT, hero_gallery_key TEXT DEFAULT NULL, hero_focus_x REAL DEFAULT NULL, hero_focus_y REAL DEFAULT NULL, hero_zoom REAL DEFAULT NULL, hero_slide REAL DEFAULT NULL, hero_fill TEXT DEFAULT NULL, hero_tone TEXT DEFAULT NULL, hero_flip INTEGER DEFAULT NULL, google_review_link TEXT, license_not_required INTEGER NOT NULL DEFAULT 0, license_not_required_by TEXT, license_not_required_at TEXT);
CREATE TABLE gm_doc_settings_history (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  actor      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_document_pdfs (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    doc_kind      TEXT NOT NULL,
    doc_id        TEXT NOT NULL,
    doc_number    TEXT,
    source_status TEXT,
    r2_key        TEXT NOT NULL,
    sha256        TEXT NOT NULL,
    byte_size     INTEGER,
    page_count    INTEGER,
    render_ms     INTEGER,
    rendered_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (doc_kind, doc_id)
);
CREATE TABLE gm_esign_consents (
  id                   TEXT PRIMARY KEY,
  doc_kind             TEXT NOT NULL,
  doc_id               TEXT NOT NULL,
  consented_at         TEXT NOT NULL,
  ip                   TEXT,
  user_agent           TEXT,
  consent_text_version TEXT NOT NULL,
  doc_sha256           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_estimate_items (
  id                    TEXT PRIMARY KEY,
  estimate_id           TEXT NOT NULL,
  option_id             TEXT NOT NULL,
  category              TEXT,
  pricing_id            TEXT,                  -- gm_pricing row it came from, if any
  item_name             TEXT NOT NULL,
  description           TEXT,
  line_type             TEXT NOT NULL DEFAULT 'standard',  -- standard | included | allowance
  qty                   REAL NOT NULL DEFAULT 1,
  unit                  TEXT,
  rate_cents            INTEGER NOT NULL DEFAULT 0,
  amount_cents          INTEGER NOT NULL DEFAULT 0,
  preset_rate_cents     INTEGER,               -- the price-list rate at the time, when overridden
  rate_override_reason  TEXT,
  material_cost_cents   INTEGER,
  labor_cost_cents      INTEGER,
  other_cost_cents      INTEGER,
  is_addon              INTEGER NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE gm_estimate_options (
  id              TEXT PRIMARY KEY,
  estimate_id     TEXT NOT NULL,
  tier            TEXT NOT NULL,               -- best | better | good | single
  label           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL DEFAULT 0
, discount_type TEXT, discount_value REAL);
CREATE TABLE gm_estimates (
  id                       TEXT PRIMARY KEY,
  client_id                TEXT NOT NULL,
  lead_id                  TEXT NOT NULL,
  job_id                   TEXT,
  number                   TEXT NOT NULL,       -- EST-0001, shared by every revision
  revision                 INTEGER NOT NULL DEFAULT 1,
  status                   TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | viewed | changes_requested | accepted | declined | expired | superseded | void
  mode                     TEXT NOT NULL DEFAULT 'single', -- single | tiered
  job_name                 TEXT NOT NULL,
  customer_name            TEXT,
  customer_email           TEXT,
  customer_phone           TEXT,
  customer_address         TEXT,
  valid_until              TEXT,               -- YYYY-MM-DD
  discount_type            TEXT,               -- amount | pct
  discount_value           REAL,               -- cents when amount, percent when pct
  schedule_json            TEXT NOT NULL DEFAULT '[]',  -- [{label, pct, amount_cents}]
  terms_included           TEXT,
  terms_excluded           TEXT,
  customer_notes           TEXT,               -- printed
  internal_notes           TEXT,               -- never printed
  public_token             TEXT NOT NULL,
  sent_at                  TEXT,
  first_viewed_at          TEXT,
  last_viewed_at           TEXT,
  responded_at             TEXT,
  change_request_text      TEXT,
  decline_reason           TEXT,
  accepted_option_id       TEXT,
  accepted_signer_name     TEXT,
  accepted_signature_kind  TEXT,               -- typed | drawn
  accepted_signature_r2_key TEXT,
  accepted_ip              TEXT,
  accepted_user_agent      TEXT,
  accepted_at              TEXT,
  accepted_by_kind         TEXT,               -- customer | contractor
  accepted_by_actor        TEXT,
  content_hash             TEXT,               -- SHA-256 of the exact snapshot accepted
  snapshot_r2_key          TEXT,
  pdf_r2_key               TEXT,
  created_by               TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason              TEXT,
  voided_by                TEXT,
  voided_at                TEXT
, brand_override_json TEXT DEFAULT NULL, link_disabled_at TEXT, link_enabled_at TEXT);
CREATE TABLE gm_events (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  title        TEXT NOT NULL,
  event_date   TEXT NOT NULL,
  start_time   TEXT,
  end_time     TEXT,
  all_day      INTEGER NOT NULL DEFAULT 0,
  location     TEXT,
  description  TEXT,
  job_id       TEXT REFERENCES gm_jobs(id),
  lead_id      TEXT REFERENCES gm_leads(id),
  assigned_to  TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
, title_overridden INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gm_finance (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  mes        TEXT,                                       -- cycle month name
  data       TEXT,                                       -- ISO date
  descricao  TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  tipo       TEXT NOT NULL,                              -- 'Entrada' | 'Saída' — derived, see above
  valor      REAL NOT NULL,                              -- always a number by construction
  obra_id    TEXT REFERENCES gm_jobs(id),                -- OBRA VINCULADA — real FK
  obs        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, invoice_payment_id TEXT DEFAULT NULL, auto_kind TEXT DEFAULT NULL);
CREATE TABLE gm_homeowner_responses (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT,
  lead_id     TEXT,
  doc_kind    TEXT NOT NULL,          -- contract | change_order | ack_before_photos | ack_completion
  doc_id      TEXT NOT NULL,
  doc_number  TEXT,
  response    TEXT NOT NULL,          -- changes_requested | declined
  reason      TEXT,
  customer_name TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at     TEXT,
  seen_by     TEXT
);
CREATE TABLE gm_invoice_credits (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- credit | refund
  number        TEXT NOT NULL,                 -- CR-0001 | REF-0001
  amount_cents  INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  payment_id    TEXT,                          -- refunds: the payment the money was returned against
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_invoice_items (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL,
  description   TEXT NOT NULL,
  qty           REAL NOT NULL DEFAULT 1,
  unit          TEXT,
  rate_cents    INTEGER NOT NULL DEFAULT 0,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  reason        TEXT,                          -- why a line was added after creation (late fee)
  sort_order    INTEGER NOT NULL DEFAULT 0
, item_kind TEXT);
CREATE TABLE gm_invoice_payments (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,
  paid_date         TEXT,                      -- YYYY-MM-DD
  method            TEXT NOT NULL,             -- zelle | check | cash | money_order | bank_transfer | card | other
  reference         TEXT,
  note              TEXT,
  state             TEXT NOT NULL DEFAULT 'pending_verification',  -- pending_verification | verified | rejected | reversed
  recorded_by       TEXT,
  recorded_by_role  TEXT,                      -- owner | seller | admin
  recorded_at       TEXT NOT NULL DEFAULT (datetime('now')),
  verified_by       TEXT,
  verified_at       TEXT,
  reject_reason     TEXT,
  reversed_by       TEXT,
  reversed_at       TEXT,
  reverse_reason    TEXT,
  receipt_number    TEXT,                      -- RCT-0001, issued on verification
  receipt_token     TEXT                       -- public token for receipt-view (the token is the credential)
, balance_before_cents INTEGER, balance_after_cents INTEGER, contract_remaining_after_cents INTEGER, link_disabled_at TEXT);
CREATE TABLE gm_invoices (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  lead_id          TEXT,
  estimate_id      TEXT,                       -- the accepted estimate the schedule came from
  number           TEXT NOT NULL,              -- INV-0001 per client
  step_label       TEXT,                       -- the payment-schedule step (Deposit, Completion...)
  step_pct         REAL,
  status           TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | void
  issue_date       TEXT,                       -- YYYY-MM-DD
  due_date         TEXT,                       -- YYYY-MM-DD
  amount_cents     INTEGER NOT NULL DEFAULT 0, -- sum of gm_invoice_items
  public_token     TEXT NOT NULL,
  sent_at          TEXT,
  first_viewed_at  TEXT,
  created_by       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  void_reason      TEXT,
  voided_by        TEXT,
  voided_at        TEXT
, late_fee_cents INTEGER NOT NULL DEFAULT 0, late_fee_through TEXT, changed_after_send_at TEXT, brand_override_json TEXT DEFAULT NULL, link_disabled_at TEXT);
CREATE TABLE gm_job_acks (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  lead_id        TEXT,
  kind           TEXT NOT NULL,          -- before_photos | completion
  status         TEXT NOT NULL DEFAULT 'sent',   -- sent | viewed | signed | declined | void
  public_token   TEXT NOT NULL,
  payload_json   TEXT,                   -- frozen set: photos [{id,note,created_at}] or punch items [{text,done_at}]
  statement      TEXT,                   -- the sentence the homeowner signs
  snapshot_r2_key TEXT, content_hash TEXT,
  sent_at TEXT, first_viewed_at TEXT,
  signer_name TEXT, signed_at TEXT, signature_kind TEXT, signature_r2_key TEXT, signed_ip TEXT, signed_ua TEXT,
  decline_reason TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
, void_reason TEXT, link_disabled_at TEXT);
CREATE TABLE gm_job_affidavits (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'notary',   -- notary | declaration (s. 92.525, admin switch)
  payload_json   TEXT,
  generated_by   TEXT, generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notarized_r2_key TEXT, notarized_content_type TEXT, notarized_at TEXT, notarized_uploaded_by TEXT
);
CREATE TABLE gm_job_condition_photos (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  content_type TEXT,
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_job_lienors (
  id                 TEXT PRIMARY KEY,
  client_id          TEXT NOT NULL,
  job_id             TEXT NOT NULL,
  name               TEXT NOT NULL,
  notice_date        TEXT,               -- YYYY-MM-DD the Notice to Owner was served
  amount_claimed_cents INTEGER,
  note               TEXT,
  conditional_release_r2_key TEXT, conditional_release_at TEXT, conditional_release_note TEXT,
  unconditional_release_r2_key TEXT, unconditional_release_at TEXT, unconditional_release_note TEXT,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT, removed_reason TEXT
);
CREATE TABLE gm_job_photos (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES gm_jobs(id) ON DELETE CASCADE,
  -- Denormalised from the job so every read can scope by client without a
  -- join, and so a photo can never be served against the wrong client even
  -- if a job_id is guessed.
  client_id   TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  caption     TEXT,
  uploaded_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
, content_type TEXT, file_name    TEXT);
CREATE TABLE gm_job_punch_items (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  text        TEXT NOT NULL,
  photo_r2_key TEXT, photo_content_type TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT, done_by TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT
, removed_reason TEXT, removed_by TEXT);
CREATE TABLE gm_job_subcontractors (
  id               TEXT PRIMARY KEY,
  client_id        TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  subcontractor_id TEXT NOT NULL,
  warning_json     TEXT,                 -- what was wrong at assignment time (no license / expired), if anything
  assigned_by TEXT, assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT
);
CREATE TABLE gm_job_suppliers (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  job_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  supplies    TEXT,                -- what they supply (free text)
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at  TEXT
);
CREATE TABLE gm_job_value_history (
    id          TEXT PRIMARY KEY,
    client_id   TEXT NOT NULL,
    job_id      TEXT,
    lead_id     TEXT,
    entity      TEXT NOT NULL,
    field       TEXT NOT NULL,
    old_value,
    new_value,
    source      TEXT NOT NULL,
    source_ref  TEXT,
    actor       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_jobs (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  obra            TEXT NOT NULL,                         -- CLIENTE / OBRA
  mes_entrega     TEXT,                                  -- cycle month name
  valor           REAL,                                  -- VALOR ($)
  material        REAL,                                  -- MATERIAL ($)
  mao_de_obra     REAL,                                  -- MÃO DE OBRA ($)
  outros          REAL,                                  -- OUTROS ($)
  inicio          TEXT,                                  -- ISO date
  prazo_previsto  TEXT,                                  -- ISO date
  entrega_real    TEXT,                                  -- ISO date
  status          TEXT NOT NULL DEFAULT 'Em andamento',  -- Em andamento | Concluída | Atrasada | Pausada
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, vendedor TEXT, custo_administrativo REAL, comissao REAL, imposto REAL, lead_id TEXT REFERENCES gm_leads(id), legacy_closed INTEGER NOT NULL DEFAULT 0, job_name TEXT DEFAULT NULL, contract_price_cents INTEGER DEFAULT NULL, final_total_cents INTEGER DEFAULT NULL);
CREATE TABLE gm_lead_contacts (
  id         TEXT PRIMARY KEY,
  lead_id    TEXT NOT NULL REFERENCES gm_leads(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL,                         -- tenant scope, denormalized
  method     TEXT NOT NULL,                         -- WhatsApp | Phone call | Email | In person | Text message
  result     TEXT,                                  -- No response | Answered | ...
  notes      TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
, logged_by TEXT, objection TEXT);
CREATE TABLE gm_lead_events (
  id          TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  actor       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
, reason TEXT);
CREATE TABLE gm_lead_files (
  id           TEXT PRIMARY KEY,
  lead_id      TEXT NOT NULL REFERENCES gm_leads(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  r2_key       TEXT NOT NULL,
  file_name    TEXT,
  content_type TEXT NOT NULL,
  caption      TEXT,
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_leads (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL,
  mes_lead          TEXT,                                -- MÊS LEAD (cycle month name)
  data_lead         TEXT,                                -- DATA/HORA LEAD (ISO datetime)
  cliente           TEXT NOT NULL,                       -- CLIENTE — required, the row's existence key
  telefone          TEXT,
  origem            TEXT,                                -- ORIGEM dropdown
  parceiro_id       TEXT REFERENCES gm_partners(id),     -- PARCEIRO — REAL FK, not a name string
  servico           TEXT,                                -- SERVIÇO (per-client list)
  observacao        TEXT,                                -- OBSERVAÇÃO DO TRABALHO
  vendedor          TEXT,                                -- VENDEDOR (per-client list)
  data_contato      TEXT,                                -- DATA/HORA 1º CONTATO → 5-minute SLA
  data_estimate     TEXT,                                -- DATA/HORA ESTIMATE → 24-hour SLA
  valor             REAL,                                -- VALOR ESTIMATE ($)
  estagio           TEXT NOT NULL DEFAULT 'Novo Lead',   -- ESTÁGIO (the 8 fixed stages)
  followups         INTEGER,                             -- Nº FOLLOW-UPS
  proxima_acao      TEXT,                                -- PRÓXIMA AÇÃO (free text in practice)
  mes_fechamento    TEXT,                                -- MÊS FECHAMENTO
  stage_changed_at  TEXT NOT NULL DEFAULT (datetime('now')), -- drives "days in stage"
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
, email TEXT, address TEXT, city TEXT, servico_desc TEXT, status_financiamento TEXT, created_by TEXT, updated_by TEXT, material REAL, mao_de_obra REAL, outros REAL, custo_administrativo REAL, comissao REAL, imposto REAL, vendedor_secundario TEXT, estimate_sent_at TEXT, commission_review_json TEXT, property_county TEXT DEFAULT NULL, property_type TEXT DEFAULT NULL, contract_price_cents INTEGER DEFAULT NULL, final_total_cents INTEGER DEFAULT NULL, referrer_to_confirm INTEGER DEFAULT NULL, actual_referrer TEXT DEFAULT NULL, meta_leadgen_id TEXT, meta_platform TEXT, meta_campaign_name TEXT, meta_ad_name TEXT, meta_form_id TEXT, meta_answers_json TEXT, addr_street TEXT, addr_city TEXT, addr_state TEXT, addr_zip TEXT, addr_access TEXT, addr_lat REAL, addr_lon REAL, addr_located TEXT, thumbtack_negotiation_id TEXT, thumbtack_category TEXT, thumbtack_details_json TEXT, thumbtack_lead_price TEXT);
CREATE TABLE gm_meta_connections (
  client_id            TEXT PRIMARY KEY,
  token_sealed         TEXT NOT NULL,
  meta_business_id     TEXT,
  meta_user_id         TEXT,
  connected_by         TEXT,
  connected_login      TEXT,
  connected_at         TEXT NOT NULL DEFAULT (datetime('now')),
  needs_reconnect      INTEGER NOT NULL DEFAULT 0,
  reconnect_pushed_at  TEXT,
  last_error           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_meta_deletions (
  code                 TEXT PRIMARY KEY,
  connections_removed  INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_meta_events (
  id                 TEXT PRIMARY KEY,
  leadgen_id         TEXT NOT NULL UNIQUE,
  page_id            TEXT,
  client_id          TEXT,
  form_id            TEXT,
  ad_id              TEXT,
  status             TEXT NOT NULL DEFAULT 'received',
  error              TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  duplicates         INTEGER NOT NULL DEFAULT 0,
  raw_event          TEXT,
  raw_lead           TEXT,
  lead_id            TEXT,
  event_created_time TEXT,
  received_at        TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at         TEXT,
  processed_at       TEXT
);
CREATE TABLE gm_meta_oauth_states (
  state        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  login_key    TEXT,
  actor_name   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);
CREATE TABLE gm_meta_pages (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  page_id       TEXT NOT NULL,
  page_name     TEXT,
  token_sealed  TEXT NOT NULL,
  subscribed    INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  last_lead_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, page_id)
);
CREATE TABLE gm_notes (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('lead','job')),
  parent_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_partners (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  tipo              TEXT,                                -- from gm_config.partner_types_json
  contato           TEXT,
  status            TEXT NOT NULL DEFAULT 'Prospectando', -- Prospectando | Ativo | Inativo
  ultima_interacao  TEXT,                                -- ISO date
  proxima_acao      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
, referral_slug TEXT, lead_id TEXT DEFAULT NULL, card_token TEXT DEFAULT NULL, seller_name TEXT DEFAULT NULL);
CREATE TABLE gm_pricing (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  item            TEXT NOT NULL,           -- what they sell. Seeded from gm_config.servicos_json.
  unit            TEXT,                    -- unidade: "un", "kg", "m2", "hora"
  cost_breakdown  TEXT NOT NULL DEFAULT '[]',  -- JSON [{label, amount}] -- the itemisation
  cost_total      REAL,                    -- cache of SUM(cost_breakdown[].amount); recomputed on write
  price           REAL,                    -- what they charge
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      TEXT,
  updated_by      TEXT
, category TEXT, kind TEXT NOT NULL DEFAULT 'product', description TEXT);
CREATE TABLE gm_referral_hits (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_roadmap (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  mes          TEXT,                                     -- cycle month name
  acao         TEXT NOT NULL,
  frente       TEXT,                                     -- Comercial | Gestão | ... (fixed list)
  responsavel  TEXT,
  status       TEXT NOT NULL DEFAULT 'Pendente',         -- Realizado | Em andamento | Pendente | Atrasado | Cancelado
  observacoes  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_seller_login_requests (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL,
    seller_name   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
    requested_by  TEXT,
    resolved_at   TEXT,
    resolved_by   TEXT,
    UNIQUE (client_id, seller_name)
);
CREATE TABLE gm_seller_profiles (
    client_id    TEXT NOT NULL,
    seller_name  TEXT NOT NULL,
    phone        TEXT,
    email        TEXT,
    title        TEXT,
    photo_r2_key TEXT,
    updated_by   TEXT,
    updated_at   TEXT,
    PRIMARY KEY (client_id, seller_name)
);
CREATE TABLE gm_send_log (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  kind           TEXT NOT NULL,
  project_id     TEXT,
  lead_id        TEXT,
  channel        TEXT NOT NULL,
  actor_user_id  TEXT,
  actor_name     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_stripe_acceptances (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_name TEXT,
  user_role TEXT,
  accepted_at TEXT NOT NULL,
  terms_version TEXT,
  privacy_version TEXT,
  terms_sha256 TEXT,
  privacy_sha256 TEXT,
  shown_language TEXT,
  shown_text TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  stripe_account_id TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_stripe_accounts (client_id TEXT PRIMARY KEY, stripe_account_id TEXT NOT NULL, charges_enabled INTEGER NOT NULL DEFAULT 0, details_submitted INTEGER NOT NULL DEFAULT 0, livemode INTEGER NOT NULL DEFAULT 0, connected_by TEXT, created_at TEXT, updated_at TEXT, accepted_at TEXT, tap_enabled INTEGER NOT NULL DEFAULT 0, tap_accepted_at TEXT, tap_accepted_by TEXT);
CREATE TABLE gm_stripe_events (event_id TEXT PRIMARY KEY, client_id TEXT, invoice_id TEXT, created_at TEXT);
CREATE TABLE gm_stripe_terminal_locations (
  client_id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE gm_subcontractors (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  name            TEXT NOT NULL,
  trade           TEXT,
  license_number  TEXT,
  coi_r2_key      TEXT, coi_expires TEXT,          -- certificate of insurance
  wc_kind         TEXT,                             -- policy | exemption | NULL
  wc_r2_key       TEXT, wc_expires TEXT,            -- workers' compensation certificate or exemption
  notes           TEXT,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, address TEXT, phone TEXT);
CREATE TABLE gm_thumbtack_businesses (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  business_id    TEXT NOT NULL,
  name           TEXT,
  webhook_token  TEXT NOT NULL,
  webhook_id     TEXT,
  subscribed     INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  last_lead_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, business_id)
);
CREATE TABLE gm_thumbtack_connections (
  client_id            TEXT PRIMARY KEY,
  token_sealed         TEXT NOT NULL,
  refresh_sealed       TEXT,
  token_expires_at     TEXT,
  thumbtack_user_id    TEXT,
  connected_by         TEXT,
  connected_login      TEXT,
  connected_at         TEXT NOT NULL DEFAULT (datetime('now')),
  needs_reconnect      INTEGER NOT NULL DEFAULT 0,
  reconnect_pushed_at  TEXT,
  last_error           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE gm_thumbtack_events (
  id              TEXT PRIMARY KEY,
  negotiation_id  TEXT NOT NULL UNIQUE,
  business_id     TEXT,
  client_id       TEXT,
  status          TEXT NOT NULL DEFAULT 'received',
  error           TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  duplicates      INTEGER NOT NULL DEFAULT 0,
  raw_event       TEXT,
  lead_id         TEXT,
  received_at     TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at      TEXT,
  processed_at    TEXT
);
CREATE TABLE gm_thumbtack_oauth_states (
  state        TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  login_key    TEXT,
  actor_name   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);
CREATE TABLE help_gaps (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  language   TEXT NOT NULL,
  question   TEXT NOT NULL,
  page_key   TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT ''
, audience TEXT NOT NULL DEFAULT '');
CREATE TABLE hidden_finance_categories (
  category_account_id TEXT PRIMARY KEY,
  hidden_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE interview_sittings (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'terms',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_by    TEXT,
  created_by_email TEXT,
  note          TEXT,
  retrieved_at  TEXT,
  retrieved_by  TEXT
);
CREATE TABLE invoice_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_number INTEGER NOT NULL
);
CREATE TABLE invoice_due_date_changes (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL,
  old_due_at   TEXT,
  new_due_at   TEXT NOT NULL,
  reason       TEXT NOT NULL,
  changed_by   TEXT,
  changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE invoice_line_items (
  id                      TEXT PRIMARY KEY,
  invoice_id              TEXT NOT NULL REFERENCES invoices(id),
  kind                    TEXT NOT NULL CHECK (kind IN ('package', 'vendor_addon')),
  label                   TEXT NOT NULL,
  amount_cents            INTEGER NOT NULL,
  client_vendor_terms_id  TEXT REFERENCES client_vendor_terms(id)
);
CREATE TABLE "invoice_payments" (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL,
  transaction_id TEXT,
  amount_cents   INTEGER,
  matched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  match_type     TEXT NOT NULL DEFAULT 'manual' CHECK (match_type IN ('auto','suggested','manual','manual_no_txn')),
  note           TEXT,
  approved_by    TEXT,
  undone_at      TEXT,
  undone_by      TEXT
, method TEXT, paid_date TEXT, reference TEXT, receipt_number TEXT, receipt_token TEXT, receipt_issued_at TEXT, recorded_by TEXT, balance_before_cents INTEGER, balance_after_cents INTEGER, dedupe_key TEXT);
CREATE TABLE invoice_recurrence (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  amount_cents          INTEGER,
  interval_n            INTEGER NOT NULL DEFAULT 1,
  interval_unit         TEXT NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('day','week','month','year')),
  next_due_at           TEXT NOT NULL,
  end_after_n           INTEGER,
  generated_count       INTEGER NOT NULL DEFAULT 0,
  last_satisfied_period TEXT,
  active                INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE invoices (
  id              TEXT PRIMARY KEY,
  client_id       TEXT,
  number          TEXT NOT NULL UNIQUE,
  amount_cents    INTEGER,
  issued_at       TEXT,
  due_at          TEXT,
  status          TEXT NOT NULL CHECK (status IN ('draft','sent','paid','void','voided_mistake')),
  sent_at         TEXT,
  paid_at         TEXT,
  voided_reason   TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  recurrence_id   TEXT,
  period_key      TEXT,
  zoho_invoice_id TEXT,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','zoho_migrated','recurrence')),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, is_installment INTEGER NOT NULL DEFAULT 0, due_date_changed_at TEXT, due_date_changed_by TEXT, due_date_change_reason TEXT, claimed_paid_at   TEXT, claimed_paid_by   TEXT, claimed_paid_note TEXT, line_description TEXT, public_token TEXT, first_viewed_at TEXT, last_viewed_at TEXT, view_count INTEGER DEFAULT 0, link_disabled_at TEXT);
CREATE TABLE lead_contact_log (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL,
  method     TEXT NOT NULL,   -- WhatsApp | Phone call | Email | In person | Text message
  result     TEXT NOT NULL,   -- No response | Answered | Left voicemail | Rescheduled | Not interested
  notes      TEXT,            -- optional, present on every entry
  logged_by  TEXT,
  logged_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE login_activity (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  client_id    TEXT,
  person_id    TEXT,
  username     TEXT,
  role         TEXT,
  kind         TEXT NOT NULL,
  detail       TEXT,
  country      TEXT,
  ip_prefix    TEXT,
  device_label TEXT
);
CREATE TABLE login_business_meta (
  client_id  TEXT PRIMARY KEY,
  source     TEXT NOT NULL DEFAULT 'apex_direct',
  updated_at TEXT
);
CREATE TABLE login_code_sends (
  id         TEXT PRIMARY KEY,
  created_at TEXT,
  person_id  TEXT,
  ip         TEXT,
  channel    TEXT NOT NULL DEFAULT 'sms'
);
CREATE TABLE login_device_events (
  id               TEXT PRIMARY KEY,
  person_id        TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  reason           TEXT NOT NULL,
  reported_loss_at TEXT,
  when_choice      TEXT,
  reported_by      TEXT,
  created_at       TEXT
);
CREATE TABLE login_invites (
  id                   TEXT PRIMARY KEY,
  person_id            TEXT NOT NULL,
  token_hash           TEXT NOT NULL UNIQUE,
  expires_at           TEXT NOT NULL,
  used_at              TEXT,
  replaced_at          TEXT,
  code_sends           INTEGER NOT NULL DEFAULT 0,
  code_verify_failures INTEGER NOT NULL DEFAULT 0,
  last_send_at         TEXT,
  stytch_method_id     TEXT,
  register_until       TEXT,
  created_at           TEXT,
  purpose              TEXT NOT NULL DEFAULT 'first'
);
CREATE TABLE login_known_places (
  person_id  TEXT NOT NULL,
  country    TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (person_id, country)
);
CREATE TABLE login_legacy_cutover (
  client_id   TEXT PRIMARY KEY,
  disabled_at TEXT NOT NULL,
  disabled_by TEXT
);
CREATE TABLE login_loss_reviews (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL,
  person_id        TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  reported_loss_at TEXT NOT NULL,
  reported_at      TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',
  flagged          INTEGER NOT NULL DEFAULT 0,
  summary          TEXT,
  reviewed_by      TEXT,
  reviewed_at      TEXT,
  note             TEXT
);
CREATE TABLE login_maintenance (
  key      TEXT PRIMARY KEY,
  last_run TEXT
);
CREATE TABLE login_passkeys (
  id                       TEXT PRIMARY KEY,
  person_id                TEXT NOT NULL,
  webauthn_registration_id TEXT NOT NULL UNIQUE,
  created_at               TEXT,
  revoked_at               TEXT,
  label                    TEXT,
  user_agent               TEXT
);
CREATE TABLE login_people (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL,
  role                  TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  phone_e164            TEXT NOT NULL,
  username              TEXT,
  stytch_user_id        TEXT,
  status                TEXT NOT NULL DEFAULT 'invited',
  created_by            TEXT,
  created_at            TEXT,
  accepted_at           TEXT,
  last_passkey_login_at TEXT, language TEXT,
  UNIQUE (client_id, phone_e164)
);
CREATE TABLE login_seat_policy (
  client_id      TEXT PRIMARY KEY,
  included_seats INTEGER NOT NULL DEFAULT 5,
  mode           TEXT NOT NULL DEFAULT 'track',
  hard_limit     INTEGER,
  set_by         TEXT,
  set_at         TEXT
);
CREATE TABLE login_seat_usage (
  client_id TEXT NOT NULL,
  day       TEXT NOT NULL,
  peak      INTEGER NOT NULL,
  PRIMARY KEY (client_id, day)
);
CREATE TABLE login_session_meta (
  token_hash TEXT PRIMARY KEY,
  person_id  TEXT,
  country    TEXT NOT NULL,
  minted_at  TEXT NOT NULL
);
CREATE TABLE meeting_prep_notes (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL,
  meeting_type TEXT NOT NULL,          -- 'xray_results' | 'kickoff' | 'weekly_rde' | 'cycle_close'
  bottleneck   TEXT,                   -- free text, his bullets, in their words
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   TEXT, matched_patterns TEXT, matched_for TEXT,
  UNIQUE (client_id, meeting_type)
);
CREATE TABLE message_templates (
  template_key  TEXT PRIMARY KEY,
  template_text TEXT NOT NULL,
  updated_at    TEXT,
  updated_by    TEXT
);
CREATE TABLE oauth_state (
  state TEXT PRIMARY KEY,
  initiated_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL
, flow TEXT NOT NULL DEFAULT 'zoho_books');
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY DEFAULT 'google_calendar',
  refresh_token TEXT NOT NULL,
  scope TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
, organization_id TEXT, access_token TEXT, access_token_expires_at INTEGER, last_read_at TEXT);
CREATE TABLE packages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER
, short_name TEXT, full_name TEXT, audience TEXT, included_items TEXT, is_popular INTEGER NOT NULL DEFAULT 0, base_price    REAL, has_payment_plan INTEGER NOT NULL DEFAULT 0, installment_count  INTEGER, installment_amount REAL, upfront_price REAL, installment_total_price REAL, default_installment_count INTEGER, default_installment_amount REAL, duration_days INTEGER);
CREATE TABLE passkey_login_attempts (
  id         TEXT PRIMARY KEY,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE passkey_sms_alerts (
  day       TEXT NOT NULL,
  threshold TEXT NOT NULL,
  sent_at   TEXT,
  PRIMARY KEY (day, threshold)
);
CREATE TABLE passkey_whatsapp_alerts (
  day       TEXT NOT NULL,
  threshold TEXT NOT NULL,
  sent_at   TEXT,
  PRIMARY KEY (day, threshold)
);
CREATE TABLE plaid_items (
  id                 TEXT PRIMARY KEY,
  plaid_item_id      TEXT UNIQUE,
  access_token       TEXT NOT NULL,
  institution        TEXT,
  status             TEXT NOT NULL DEFAULT 'good' CHECK (status IN ('good','reauth_required','revoked')),
  consent_expires_at TEXT,
  cursor             TEXT,
  last_synced_at     TEXT,
  last_webhook_at    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE prep_agendas (
    id           TEXT PRIMARY KEY,
    client_id    TEXT,
    name         TEXT,
    -- JSON array of block keys, in render order. Built-in blocks are their
    -- render function's key; custom blocks are "custom:<id>".
    blocks       TEXT NOT NULL DEFAULT '[]',
    is_template  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_by   TEXT,
    updated_at   TEXT,
    updated_by   TEXT
);
CREATE TABLE prep_custom_answers (
    id           TEXT PRIMARY KEY,
    block_id     TEXT NOT NULL,
    client_id    TEXT NOT NULL,
    answers      TEXT NOT NULL DEFAULT '{}',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by   TEXT,
    UNIQUE (block_id, client_id)
);
CREATE TABLE prep_custom_blocks (
    id           TEXT PRIMARY KEY,
    client_id    TEXT,
    title        TEXT NOT NULL,
    fields       TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    created_by   TEXT,
    built_at     TEXT,
    built_note   TEXT
);
CREATE TABLE push_sent_log (   dedupe_key TEXT PRIMARY KEY,   sent_at    TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE TABLE push_subscriptions (   id           TEXT PRIMARY KEY,   user_email   TEXT NOT NULL,   endpoint     TEXT NOT NULL UNIQUE,   p256dh       TEXT NOT NULL,   auth         TEXT NOT NULL,   user_agent   TEXT,   created_at   TEXT NOT NULL DEFAULT (datetime('now')),   last_error   TEXT,   last_sent_at TEXT , superseded_at TEXT);
CREATE TABLE reminder_text_optouts (
  phone_e164 TEXT PRIMARY KEY,
  opted_out_at TEXT NOT NULL
);
CREATE TABLE reminder_text_sends (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  phone_e164  TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  twilio_sid  TEXT,
  UNIQUE (session_id, recipient)
);
CREATE TABLE resource_categories (
  name       TEXT PRIMARY KEY,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE resources (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  resource_type TEXT NOT NULL,             -- 'contact' | 'file' | 'link'
  title         TEXT NOT NULL,
  description   TEXT,
  contact_name  TEXT,                      -- type=contact only
  contact_phone TEXT,
  contact_email TEXT,
  file_url      TEXT,                      -- type=file only (R2 key served via Worker)
  file_name     TEXT,
  url           TEXT,                      -- type=link only
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
, internal INTEGER NOT NULL DEFAULT 0);
CREATE TABLE scheduling_bookings (
    id          TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    slot_date   TEXT NOT NULL,   -- local YYYY-MM-DD
    slot_time   TEXT NOT NULL,   -- local HH:MM (24h)
    end_time    TEXT NOT NULL,
    session_id  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE scheduling_feedback (
    id          TEXT PRIMARY KEY,
    request_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,   -- earlier | later | none_work
    slot_date   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE scheduling_requests (
    id            TEXT PRIMARY KEY,
    token         TEXT NOT NULL UNIQUE,   -- the opaque public URL segment
    client_id     TEXT NOT NULL,          -- ALWAYS the id. Never the name: the
                                          -- same client exists as 'METZ',
                                          -- 'RDE - METZ ' (trailing space) and
                                          -- 'METZ - RDE'. Name matching
                                          -- silently mis-attributes history.
    client_name   TEXT NOT NULL,          -- display snapshot only, never a key
    meeting_type  TEXT NOT NULL DEFAULT 'online_meet',  -- online_meet | in_person
    duration_min  INTEGER NOT NULL DEFAULT 60,
    travel_min    INTEGER NOT NULL DEFAULT 0,  -- in-person: blocked BEFORE and
                                               -- AFTER the slot
    buffer_min    INTEGER NOT NULL DEFAULT 0,  -- online opt-in, for a client
                                               -- who notoriously runs over
    location      TEXT,
    week_start    TEXT NOT NULL,          -- local YYYY-MM-DD (Monday). ONE week
                                          -- window, never two.
    week_end      TEXT NOT NULL,          -- local YYYY-MM-DD, inclusive
    status        TEXT NOT NULL DEFAULT 'waiting',
                                          -- waiting | booked | skipped | expired | none_work
    session_id    TEXT,                   -- set when booked
    booked_at     TEXT,
    skip_reason   TEXT,                   -- vacation | emergency | client_cancelled
    squeezed_out  INTEGER NOT NULL DEFAULT 0,
                                          -- this client lost a race for a slot.
                                          -- Alice must be TOLD, or she reads the
                                          -- silence as the client ignoring her.
    sent_at       TEXT,                   -- when she actually sent the WhatsApp
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    created_by    TEXT,
    updated_at    TEXT,
    updated_by    TEXT
, followup_sent_at TEXT, followup_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE scheduling_settings (
    id                TEXT PRIMARY KEY DEFAULT 'default',
    day_start         TEXT NOT NULL DEFAULT '09:00',
    day_end           TEXT NOT NULL DEFAULT '18:00',
    work_days         TEXT NOT NULL DEFAULT '1,2,3,4,5',  -- 0=Sun .. 6=Sat
    min_notice_hours  INTEGER NOT NULL DEFAULT 4,   -- no booking 20 minutes out
    daily_cap         INTEGER NOT NULL DEFAULT 4,   -- a client-driven system must
                                                    -- not wall in Rafa's whole day
    default_duration  INTEGER NOT NULL DEFAULT 60,
    default_travel    INTEGER NOT NULL DEFAULT 30,
    updated_at        TEXT,
    updated_by        TEXT
);
CREATE TABLE send_counter_alerts (
  bucket     TEXT NOT NULL,
  period_key TEXT NOT NULL,
  threshold  TEXT NOT NULL,
  sent_at    TEXT,
  PRIMARY KEY (bucket, period_key, threshold)
);
CREATE TABLE send_counters (
  bucket     TEXT NOT NULL,
  period_key TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (bucket, period_key)
);
CREATE TABLE session_clients (
    session_id  TEXT NOT NULL,
    client_id   TEXT NOT NULL,

    -- 1 for the client that also sits in sessions.client_id, so the primary
    -- survives a rebuild of this table from scratch.
    is_primary  INTEGER NOT NULL DEFAULT 0,

    -- How the link was made: 'manual' | 'importer' | 'voice' | 'backfill'.
    -- Kept so a bad matcher run can be undone without touching hand-made links.
    source      TEXT,

    -- Room for a per-client note on a shared meeting, if that need ever appears.
    -- Shared truth on the session, optional per-client layer here.
    note        TEXT,

    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    created_by  TEXT,

    PRIMARY KEY (session_id, client_id)
);
CREATE TABLE session_events (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event      TEXT NOT NULL,   -- 'summarized' | 'approved' | 'discarded' | 'assigned_client' | 'transcript_ingested'
  actor      TEXT,            -- display name, or a system source ('fireflies', 'google_calendar')
  detail     TEXT,            -- optional context, e.g. the client a session was assigned to
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE session_summaries (id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, summary_pt TEXT, summary_en TEXT, recommendations_pt TEXT, recommendations_en TEXT, client_action_items_pt TEXT, client_action_items_en TEXT, rafa_followups_pt TEXT, rafa_followups_en TEXT, next_session_focus_pt TEXT, next_session_focus_en TEXT, client_profile_updates_pt TEXT, client_profile_updates_en TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), business_diagnosis_pt TEXT, business_diagnosis_en TEXT, swot_synthesis_pt TEXT, swot_synthesis_en TEXT, thirty_day_goals_pt TEXT, thirty_day_goals_en TEXT);
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    date        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    raw_transcript TEXT,
    summary_json   TEXT,
    approved_at    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
, pdf_data TEXT, client_id TEXT, task_completions TEXT, google_event_id TEXT, google_meet_link TEXT, calendar_provider TEXT DEFAULT 'google', fireflies_transcript_id TEXT, session_type TEXT DEFAULT 'online_meet', scheduled_by TEXT, whatsapp_sent_at TEXT, transcript_source TEXT, transcript_ingested_at TEXT, time TEXT, section_config TEXT, html_link TEXT, end_time TEXT, attendees TEXT, meeting_category TEXT NOT NULL DEFAULT 'client', location TEXT, series_id TEXT, created_by TEXT, updated_at TEXT, updated_by TEXT, reminder_sent_at TEXT, summarized_by TEXT, summarized_at TEXT, approved_by   TEXT, discarded_by  TEXT, discarded_at  TEXT, kids_covered INTEGER NOT NULL DEFAULT 0, voice_flagged INTEGER NOT NULL DEFAULT 0, voice_transcript TEXT, voice_missing TEXT, voice_gcal_error TEXT, send_text_reminder INTEGER NOT NULL DEFAULT 0);
CREATE TABLE staff_click_log (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  role       TEXT NOT NULL,
  who        TEXT NOT NULL,
  page       TEXT NOT NULL,
  control    TEXT NOT NULL,
  client_id  TEXT
);
CREATE TABLE stories (
  id           TEXT PRIMARY KEY,
  client_id    TEXT,
  person       TEXT NOT NULL,
  business     TEXT,
  country      TEXT,
  industry     TEXT,
  source       TEXT NOT NULL,
  source_url   TEXT,
  patterns     TEXT NOT NULL,
  one_liner    TEXT NOT NULL,
  signals      TEXT,
  narrative    TEXT,
  telling_note TEXT NOT NULL,
  approved     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT
, narrative_en TEXT);
CREATE TABLE stripe_charges (
  id                     TEXT PRIMARY KEY,          -- ch_...
  payment_intent_id      TEXT,
  customer_id            TEXT,                      -- cus_..., NULL for a guest payment
  customer_name          TEXT,
  customer_email         TEXT,
  billing_name           TEXT,                      -- the cardholder, which is who actually paid
  description            TEXT,
  amount_cents           INTEGER NOT NULL,
  amount_refunded_cents  INTEGER NOT NULL DEFAULT 0,
  fee_cents              INTEGER,
  net_cents              INTEGER,
  currency               TEXT,
  status                 TEXT,                      -- succeeded | pending | failed
  created_at             TEXT,                      -- UTC, from Stripe's `created`
  invoice_id             TEXT,
  -- charge.metadata.client_id. Payment links Apex creates will stamp this, so
  -- future payments need no mapping at all. It wins over the customer map.
  metadata_client_id     TEXT,
  payout_id              TEXT,                      -- po_... the bank deposit it arrived in
  synced_at              TEXT NOT NULL DEFAULT (datetime('now'))
, metadata_invoice_id TEXT, metadata_club_reg_id TEXT, pm_type TEXT);
CREATE TABLE stripe_customer_clients (
  stripe_customer_id  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES clients(id),
  note                TEXT,                         -- the evidence
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE stripe_payouts (
  id                   TEXT PRIMARY KEY,            -- po_...
  amount_cents         INTEGER NOT NULL,
  arrival_date         TEXT,                        -- YYYY-MM-DD
  status               TEXT,
  created_at           TEXT,
  charges_linked       INTEGER NOT NULL DEFAULT 0,  -- 1 once its charges were read
  bank_transaction_id  TEXT,                        -- transactions.id
  synced_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE stripe_sync_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ok          INTEGER NOT NULL,
  charges     INTEGER,
  payouts     INTEGER,
  linked      INTEGER,
  error       TEXT
);
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  monthly_cost REAL NOT NULL,
  next_renewal_date TEXT NOT NULL,
  manage_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE support_ticket_daily_counts (
  user_email TEXT,
  day TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_email, day)
);
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  reporter_email TEXT,
  reporter_name TEXT,
  language TEXT,
  kind TEXT,
  page TEXT,
  transcript_json TEXT NOT NULL DEFAULT '[]',
  original_words TEXT NOT NULL,
  summary_en TEXT,
  guidance TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE TABLE task_attachments (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  file_key      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type  TEXT,
  size_bytes    INTEGER,
  uploaded_by   TEXT,
  created_at    TEXT NOT NULL,
  removed_at    TEXT
);
CREATE TABLE task_notes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, body TEXT NOT NULL, author_email TEXT, author_role TEXT NOT NULL, author_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), body_en TEXT, body_pt TEXT);
CREATE TABLE task_voice_dumps (
    id            TEXT PRIMARY KEY,
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    language      TEXT,
    transcript    TEXT,
    status        TEXT NOT NULL DEFAULT 'received',
    error         TEXT,
    tasks_created INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "tasks" (
    id              TEXT PRIMARY KEY,
    client_id       TEXT,
    type            TEXT NOT NULL,
    description     TEXT NOT NULL,
    due_date        TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    session_id      TEXT,
    due_date_source TEXT,
    completed_by    TEXT,
    updated_at      TEXT,
    source          TEXT,
    nota            TEXT,
    created_by      TEXT
, assigned_to TEXT, completed_at TEXT, created_by_role TEXT, progress TEXT, description_en TEXT, description_pt TEXT);
CREATE TABLE transactions (
  id                           TEXT PRIMARY KEY,
  account_id                   TEXT NOT NULL,
  plaid_transaction_id         TEXT UNIQUE,
  pending_plaid_transaction_id TEXT,
  amount_cents                 INTEGER NOT NULL,
  date                         TEXT NOT NULL,
  posted_date                  TEXT,
  description                  TEXT,
  merchant_normalized          TEXT,
  category_id                  TEXT,
  is_transfer                  INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id             TEXT,
  transfer_status              TEXT NOT NULL DEFAULT 'none' CHECK (transfer_status IN ('none','suspected','confirmed','rejected')),
  pending                      INTEGER NOT NULL DEFAULT 0,
  raw_json                     TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
, category_source TEXT, categorized_at  TEXT, memo TEXT, categorized_by TEXT, voided_at TEXT, voided_reason TEXT, superseded_by TEXT);
CREATE TABLE users (
    email TEXT PRIMARY KEY,
    role  TEXT NOT NULL
, display_name TEXT, avatar_url TEXT, client_id TEXT, language TEXT);
CREATE TABLE vendor_ignored_transactions (
  transaction_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE vendor_match_reviews (
  transaction_id TEXT PRIMARY KEY,
  reviewed_by TEXT,
  reviewed_at TEXT,
  kind TEXT
);
CREATE TABLE vendor_payables (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  label TEXT NOT NULL,
  period_month TEXT,
  planned_cents INTEGER NOT NULL,
  applied_cents INTEGER NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL CHECK (trigger IN ('month','start','completion')),
  status TEXT NOT NULL CHECK (status IN ('scheduled','paused','waiting_completion','paid','cancelled')),
  paused_kind TEXT CHECK (paused_kind IN ('skip','delay') OR paused_kind IS NULL),
  pause_reason TEXT,
  paid_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, note TEXT);
CREATE TABLE vendor_payment_allocations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  payable_id TEXT NOT NULL,
  applied_cents INTEGER NOT NULL
);
CREATE TABLE vendor_payment_batches (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  unallocated_cents INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT NOT NULL,
  transaction_id TEXT,
  note TEXT,
  created_by TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  confirmed_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, kind TEXT DEFAULT 'bank' CHECK (kind IN ('bank','sent') OR kind IS NULL), sent_on TEXT, expected_cents INTEGER);
CREATE TABLE vendor_question_claude_calls (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE vendor_questions (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  text_pt TEXT,
  text_en TEXT,
  status TEXT DEFAULT 'open',
  answer_raw TEXT,
  interpreted_json TEXT,
  answered_by TEXT,
  answered_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE vendor_services (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  service_key TEXT,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('monthly','once','split')),
  price_cents INTEGER NOT NULL,
  first_month TEXT NOT NULL,
  months INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','finished','cancelled')),
  source TEXT NOT NULL CHECK (source IN ('contract','manual')),
  contract_id TEXT,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
, starts_on TEXT);
CREATE TABLE vendors (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  vendor_type         TEXT,
  contact_name        TEXT,
  contact_email       TEXT,
  contact_phone       TEXT,
  payment_method      TEXT CHECK (payment_method IS NULL OR payment_method IN ('zelle','check','ach','other')),
  payment_identifier  TEXT,
  info_complete       INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
, name_en TEXT);
CREATE TABLE watched_files (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  client_id TEXT,
  source_url TEXT,
  imported_at TEXT,
  baseline_modified TEXT,
  last_modified_seen TEXT,
  last_modifier TEXT,
  last_checked_at TEXT,
  alert_active INTEGER NOT NULL DEFAULT 0,
  alert_message TEXT,
  alert_raised_at TEXT,
  access_lost INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, sheet_config TEXT);
CREATE TABLE zoom_events (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  who        TEXT NOT NULL,
  path       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_acct_item    ON accounts(plaid_item_id);
CREATE INDEX idx_acct_purpose ON accounts(purpose, status);
CREATE INDEX idx_acvl_contract ON apex_contract_vendor_lines (contract_id);
CREATE INDEX idx_acvl_vendor ON apex_contract_vendor_lines (vendor_id, active);
CREATE UNIQUE INDEX idx_apex_club_pay_links_active ON apex_club_pay_links(registration_id) WHERE active = 1;
CREATE INDEX idx_apex_contract_events_contract ON apex_contract_events (contract_id);
CREATE INDEX idx_apex_contracts_client ON apex_contracts (client_id);
CREATE UNIQUE INDEX idx_apex_invoice_pay_links_active ON apex_invoice_pay_links(invoice_id, kind) WHERE active = 1;
CREATE UNIQUE INDEX idx_apexp_slug ON apex_partners (referral_slug);
CREATE INDEX idx_apexrh_ip ON apex_referral_hits (ip, created_at);
CREATE INDEX idx_apexrh_slug ON apex_referral_hits (slug, created_at);
CREATE INDEX idx_apns_tokens_email ON apns_device_tokens(user_email);
CREATE INDEX idx_bs_cost_entries_kind ON bs_cost_entries (kind, deleted_at);
CREATE INDEX idx_bs_lead_links_client ON bs_lead_links (client_id);
CREATE INDEX idx_ca_client ON client_assessments (client_id);
CREATE INDEX idx_cat_client ON client_auth_tokens (client_id);
CREATE INDEX idx_cbr_client ON client_blocked_ranges (client_id, start_date);
CREATE INDEX idx_cde_client_date
  ON client_daily_entries (client_id, entry_date);
CREATE INDEX idx_cla_ip ON client_login_attempts (ip, created_at);
CREATE INDEX idx_cla_username ON client_login_attempts (username, created_at);
CREATE INDEX idx_client_documents_client_visible ON client_documents (client_id, client_visible);
CREATE INDEX idx_client_documents_visibility ON client_documents (client_id, visibility);
CREATE INDEX idx_client_logins_client
  ON client_logins (client_id);
CREATE INDEX idx_client_terms_claude_calls_user ON client_terms_claude_calls (user_email, created_at);
CREATE UNIQUE INDEX idx_clients_link_slug ON clients (link_slug);
CREATE INDEX idx_clients_plan ON clients (plan);
CREATE INDEX idx_clients_referred_by ON clients (referred_by_partner_id);
CREATE INDEX idx_clients_source_type ON clients (source_type);
CREATE INDEX idx_club_dismissed_event ON apex_club_event_dismissed(event_id);
CREATE INDEX idx_club_reg_event ON apex_club_registrations(event_id);
CREATE UNIQUE INDEX idx_club_reg_pay_token ON apex_club_registrations(pay_token) WHERE pay_token IS NOT NULL;
CREATE INDEX idx_club_txns_event ON apex_club_event_txns(event_id);
CREATE INDEX idx_cvt_client ON client_vendor_terms(client_id, active);
CREATE INDEX idx_cvt_vendor ON client_vendor_terms(vendor_id, active);
CREATE INDEX idx_daily_entry_edits_client ON client_daily_entry_edits (client_id, entry_date);
CREATE UNIQUE INDEX idx_doc_links_token ON doc_links (kind, public_token);
CREATE INDEX idx_due_date_changes_invoice ON invoice_due_date_changes(invoice_id, changed_at);
CREATE INDEX idx_due_date_changes_when ON invoice_due_date_changes(changed_at);
CREATE INDEX idx_fixed_bills_active ON fixed_bills(active, purpose);
CREATE INDEX idx_fixed_bills_priority ON fixed_bills(priority_rank);
CREATE INDEX idx_gm_booking_requests_lead ON gm_booking_requests (client_id, lead_id);
CREATE UNIQUE INDEX idx_gm_booking_requests_slot
    ON gm_booking_requests (client_id, slot_date, slot_time) WHERE status = 'booked';
CREATE INDEX idx_gm_change_orders_job ON gm_change_orders (client_id, job_id);
CREATE UNIQUE INDEX idx_gm_change_orders_token ON gm_change_orders (public_token);
CREATE INDEX idx_gm_contract_events_contract ON gm_contract_events (contract_id);
CREATE INDEX idx_gm_contract_notices_job ON gm_contract_notices (client_id, job_id);
CREATE INDEX idx_gm_contract_own_templates_client ON gm_contract_own_templates (client_id, created_at);
CREATE INDEX idx_gm_contracts_job ON gm_contracts (client_id, job_id);
CREATE UNIQUE INDEX idx_gm_contracts_token ON gm_contracts (public_token);
CREATE INDEX idx_gm_doc_settings_history_client
  ON gm_doc_settings_history (client_id, created_at);
CREATE INDEX idx_gm_esign_consents_doc ON gm_esign_consents (doc_kind, doc_id);
CREATE INDEX idx_gm_estimate_items_est ON gm_estimate_items (estimate_id, option_id, sort_order);
CREATE INDEX idx_gm_estimate_options_est ON gm_estimate_options (estimate_id, sort_order);
CREATE INDEX idx_gm_estimates_client ON gm_estimates (client_id, created_at);
CREATE INDEX idx_gm_estimates_lead ON gm_estimates (lead_id, created_at);
CREATE UNIQUE INDEX idx_gm_estimates_token ON gm_estimates (public_token);
CREATE INDEX idx_gm_events_client_date ON gm_events (client_id, event_date);
CREATE INDEX idx_gm_events_job ON gm_events (job_id);
CREATE INDEX idx_gm_events_lead ON gm_events (lead_id);
CREATE INDEX idx_gm_homeowner_responses_client ON gm_homeowner_responses (client_id, seen_at);
CREATE INDEX idx_gm_invoice_credits_inv ON gm_invoice_credits (invoice_id, created_at);
CREATE INDEX idx_gm_invoice_items_inv ON gm_invoice_items (invoice_id, sort_order);
CREATE INDEX idx_gm_invoice_payments_client ON gm_invoice_payments (client_id, state);
CREATE INDEX idx_gm_invoice_payments_inv ON gm_invoice_payments (invoice_id, recorded_at);
CREATE UNIQUE INDEX idx_gm_invoice_payments_receipt_token ON gm_invoice_payments (receipt_token);
CREATE INDEX idx_gm_invoices_client ON gm_invoices (client_id, created_at);
CREATE INDEX idx_gm_invoices_job ON gm_invoices (job_id);
CREATE UNIQUE INDEX idx_gm_invoices_token ON gm_invoices (public_token);
CREATE INDEX idx_gm_job_acks_job ON gm_job_acks (client_id, job_id);
CREATE UNIQUE INDEX idx_gm_job_acks_token ON gm_job_acks (public_token);
CREATE INDEX idx_gm_job_affidavits_job ON gm_job_affidavits (client_id, job_id);
CREATE INDEX idx_gm_job_condition_photos_job ON gm_job_condition_photos (client_id, job_id);
CREATE INDEX idx_gm_job_lienors_job ON gm_job_lienors (client_id, job_id);
CREATE INDEX idx_gm_job_photos_client
  ON gm_job_photos (client_id);
CREATE INDEX idx_gm_job_photos_job
  ON gm_job_photos (job_id, created_at);
CREATE INDEX idx_gm_job_punch_items_job ON gm_job_punch_items (client_id, job_id);
CREATE INDEX idx_gm_job_subcontractors_job ON gm_job_subcontractors (client_id, job_id);
CREATE INDEX idx_gm_job_suppliers_job ON gm_job_suppliers (client_id, job_id);
CREATE INDEX idx_gm_job_value_history_job ON gm_job_value_history (client_id, job_id, created_at);
CREATE INDEX idx_gm_job_value_history_lead ON gm_job_value_history (client_id, lead_id, created_at);
CREATE UNIQUE INDEX idx_gm_jobs_lead_id ON gm_jobs(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_gm_lead_events_client ON gm_lead_events (client_id, created_at);
CREATE INDEX idx_gm_lead_events_lead ON gm_lead_events (lead_id, created_at);
CREATE INDEX idx_gm_lead_files_client ON gm_lead_files (client_id);
CREATE INDEX idx_gm_lead_files_lead ON gm_lead_files (lead_id, created_at);
CREATE INDEX idx_gm_meta_conn_user ON gm_meta_connections (meta_user_id);
CREATE INDEX idx_gm_meta_events_page ON gm_meta_events (page_id, status);
CREATE INDEX idx_gm_meta_events_status ON gm_meta_events (status, received_at);
CREATE INDEX idx_gm_meta_pages_page ON gm_meta_pages (page_id, subscribed);
CREATE INDEX idx_gm_notes_client ON gm_notes (client_id);
CREATE INDEX idx_gm_notes_parent ON gm_notes (parent_type, parent_id, created_at);
CREATE UNIQUE INDEX idx_gm_partners_card_token ON gm_partners (card_token) WHERE card_token IS NOT NULL;
CREATE UNIQUE INDEX idx_gm_partners_client_lead ON gm_partners (client_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_gm_pricing_client
  ON gm_pricing (client_id, sort_order, item);
CREATE UNIQUE INDEX idx_gm_pricing_client_item
  ON gm_pricing (client_id, item COLLATE NOCASE);
CREATE INDEX idx_gm_seller_login_requests_client
    ON gm_seller_login_requests (client_id);
CREATE INDEX idx_gm_seller_login_requests_status
    ON gm_seller_login_requests (status, requested_at);
CREATE INDEX idx_gm_send_log_lead ON gm_send_log (client_id, kind, lead_id, created_at);
CREATE INDEX idx_gm_send_log_project ON gm_send_log (client_id, kind, project_id, created_at);
CREATE INDEX idx_gm_stripe_acceptances_client ON gm_stripe_acceptances (client_id, accepted_at);
CREATE INDEX idx_gm_stripe_accounts_acct ON gm_stripe_accounts (stripe_account_id);
CREATE INDEX idx_gm_subcontractors_client ON gm_subcontractors (client_id);
CREATE UNIQUE INDEX idx_gm_tt_biz_token ON gm_thumbtack_businesses (webhook_token);
CREATE INDEX idx_gm_tt_events_status ON gm_thumbtack_events (status, received_at);
CREATE INDEX idx_gmb_client ON gm_base_ouro (client_id);
CREATE INDEX idx_gmf_client ON gm_finance (client_id);
CREATE UNIQUE INDEX idx_gmf_invoice_payment ON gm_finance (invoice_payment_id, auto_kind) WHERE invoice_payment_id IS NOT NULL;
CREATE INDEX idx_gmf_obra ON gm_finance (obra_id);
CREATE INDEX idx_gmj_client ON gm_jobs (client_id);
CREATE INDEX idx_gml_client ON gm_leads (client_id);
CREATE INDEX idx_gml_meta_leadgen ON gm_leads (client_id, meta_leadgen_id);
CREATE INDEX idx_gml_parceiro ON gm_leads (parceiro_id);
CREATE INDEX idx_gml_thumbtack_neg ON gm_leads (client_id, thumbtack_negotiation_id);
CREATE INDEX idx_gmlc_client ON gm_lead_contacts (client_id);
CREATE INDEX idx_gmlc_client_logged_by ON gm_lead_contacts (client_id, logged_by);
CREATE INDEX idx_gmlc_lead ON gm_lead_contacts (lead_id, logged_at);
CREATE INDEX idx_gmp_client ON gm_partners (client_id);
CREATE UNIQUE INDEX idx_gmp_slug ON gm_partners (referral_slug);
CREATE INDEX idx_gmr_client ON gm_roadmap (client_id);
CREATE INDEX idx_gmrh_ip ON gm_referral_hits (ip, created_at);
CREATE INDEX idx_gmrh_slug ON gm_referral_hits (slug, created_at);
CREATE INDEX idx_growth_client ON client_growth_entries (client_id);
CREATE INDEX idx_growth_month  ON client_growth_entries (month_label);
CREATE INDEX idx_help_gaps_created ON help_gaps (created_at);
CREATE INDEX idx_ili_cvt     ON invoice_line_items(client_vendor_terms_id);
CREATE INDEX idx_ili_invoice ON invoice_line_items(invoice_id);
CREATE INDEX idx_interview_sittings_open
  ON interview_sittings (retrieved_at, created_at);
CREATE INDEX idx_inv_client     ON invoices(client_id, status);
CREATE INDEX idx_inv_client_installment ON invoices(client_id, is_installment, status);
CREATE INDEX idx_inv_status_due ON invoices(status, due_at);
CREATE UNIQUE INDEX idx_inv_zoho ON invoices(zoho_invoice_id) WHERE zoho_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX idx_invoices_public_token ON invoices(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX idx_lcl_client ON lead_contact_log (client_id, logged_at);
CREATE INDEX idx_login_activity_at ON login_activity (at);
CREATE INDEX idx_login_activity_client ON login_activity (client_id, at);
CREATE INDEX idx_login_activity_person ON login_activity (person_id, at);
CREATE INDEX idx_login_activity_username ON login_activity (username, at);
CREATE INDEX idx_login_code_sends_created ON login_code_sends (created_at);
CREATE INDEX idx_login_code_sends_ip ON login_code_sends (ip, created_at);
CREATE INDEX idx_login_code_sends_person ON login_code_sends (person_id, created_at);
CREATE INDEX idx_login_device_events_client ON login_device_events (client_id, created_at);
CREATE INDEX idx_login_device_events_person ON login_device_events (person_id, created_at);
CREATE INDEX idx_login_invites_person ON login_invites (person_id);
CREATE INDEX idx_login_loss_reviews_client ON login_loss_reviews (client_id);
CREATE INDEX idx_login_loss_reviews_person ON login_loss_reviews (person_id);
CREATE INDEX idx_login_loss_reviews_status ON login_loss_reviews (status);
CREATE INDEX idx_login_passkeys_person ON login_passkeys (person_id);
CREATE INDEX idx_login_people_client ON login_people (client_id);
CREATE INDEX idx_login_people_stytch ON login_people (stytch_user_id);
CREATE UNIQUE INDEX idx_pay_dedupe ON invoice_payments(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_pay_invoice ON invoice_payments(invoice_id, undone_at);
CREATE UNIQUE INDEX idx_pay_receipt_number ON invoice_payments(receipt_number) WHERE receipt_number IS NOT NULL;
CREATE UNIQUE INDEX idx_pay_receipt_token  ON invoice_payments(receipt_token)  WHERE receipt_token  IS NOT NULL;
CREATE INDEX idx_pay_txn     ON invoice_payments(transaction_id, undone_at);
CREATE INDEX idx_payer_aliases_client ON client_payer_aliases(client_id);
CREATE INDEX idx_pla_ip ON passkey_login_attempts (ip, created_at);
CREATE INDEX idx_prep_agendas_client
    ON prep_agendas (client_id);
CREATE INDEX idx_prep_agendas_template
    ON prep_agendas (is_template);
CREATE INDEX idx_prep_custom_blocks_open
    ON prep_custom_blocks (built_at);
CREATE INDEX idx_push_subs_email ON push_subscriptions(user_email);
CREATE INDEX idx_rec_active_due ON invoice_recurrence(active, next_due_at);
CREATE INDEX idx_rec_client     ON invoice_recurrence(client_id, active);
CREATE UNIQUE INDEX idx_rules_pattern
  ON categorization_rules(pattern, match_type, scope);
CREATE INDEX idx_sched_booking_req ON scheduling_bookings(request_id);
CREATE UNIQUE INDEX idx_sched_booking_slot
    ON scheduling_bookings(slot_date, slot_time);
CREATE INDEX idx_sched_feedback_client ON scheduling_feedback(client_id, kind);
CREATE INDEX idx_sched_req_client ON scheduling_requests(client_id);
CREATE INDEX idx_sched_req_status ON scheduling_requests(status, created_at);
CREATE INDEX idx_session_clients_client ON session_clients (client_id);
CREATE INDEX idx_session_clients_session ON session_clients (session_id);
CREATE INDEX idx_session_events_session ON session_events (session_id, created_at);
CREATE INDEX idx_staff_click_control ON staff_click_log (control, created_at);
CREATE INDEX idx_staff_click_created ON staff_click_log (created_at);
CREATE INDEX idx_stories_approved ON stories (approved);
CREATE INDEX idx_stripe_charges_customer ON stripe_charges(customer_id);
CREATE INDEX idx_stripe_charges_payout   ON stripe_charges(payout_id);
CREATE INDEX idx_support_tickets_status ON support_tickets (status, created_at);
CREATE INDEX idx_task_attachments_task ON task_attachments (task_id);
CREATE INDEX idx_task_notes_task ON task_notes (task_id, created_at);
CREATE INDEX idx_tasks_client ON tasks (client_id, status);
CREATE INDEX idx_tasks_session ON tasks (session_id);
CREATE UNIQUE INDEX idx_tasks_session_dedupe ON tasks (session_id, type, description) WHERE session_id IS NOT NULL;
CREATE INDEX idx_tasks_source_due ON tasks (source, due_date);
CREATE INDEX idx_tasks_status_due ON tasks (status, due_date);
CREATE INDEX idx_transactions_voided ON transactions(voided_at) WHERE voided_at IS NOT NULL;
CREATE INDEX idx_txn_account_date  ON transactions(account_id, date DESC);
CREATE INDEX idx_txn_amount_date   ON transactions(amount_cents, date);
CREATE INDEX idx_txn_category    ON transactions(category_id);
CREATE INDEX idx_txn_date          ON transactions(date DESC);
CREATE INDEX idx_txn_merchant    ON transactions(merchant_normalized);
CREATE INDEX idx_txn_pending_id    ON transactions(pending_plaid_transaction_id);
CREATE INDEX idx_txn_transfer      ON transactions(transfer_status, is_transfer);
CREATE INDEX idx_vendor_payables_client ON vendor_payables (client_id);
CREATE INDEX idx_vendor_payables_period ON vendor_payables (period_month);
CREATE INDEX idx_vendor_payables_service ON vendor_payables (service_id);
CREATE INDEX idx_vendor_payables_vendor ON vendor_payables (vendor_id, status);
CREATE INDEX idx_vendor_payment_allocations_batch ON vendor_payment_allocations (batch_id);
CREATE INDEX idx_vendor_payment_allocations_payable ON vendor_payment_allocations (payable_id);
CREATE INDEX idx_vendor_payment_batches_txn ON vendor_payment_batches (transaction_id);
CREATE INDEX idx_vendor_payment_batches_vendor ON vendor_payment_batches (vendor_id);
CREATE INDEX idx_vendor_question_claude_calls_user ON vendor_question_claude_calls (user_email, created_at);
CREATE INDEX idx_vendor_services_client ON vendor_services (client_id);
CREATE UNIQUE INDEX idx_vendor_services_contract_service
  ON vendor_services (contract_id, service_key) WHERE contract_id IS NOT NULL;
CREATE INDEX idx_vendor_services_vendor ON vendor_services (vendor_id, status);
CREATE INDEX idx_vendors_active ON vendors(active);
CREATE INDEX idx_watched_files_active ON watched_files(active, alert_active);
CREATE INDEX idx_zoom_events_created ON zoom_events (created_at);
CREATE INDEX idx_zoom_events_who_created ON zoom_events (who, created_at);
