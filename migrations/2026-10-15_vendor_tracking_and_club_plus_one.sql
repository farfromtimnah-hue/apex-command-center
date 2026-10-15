-- Fornecedores (vendor payable tracking) + Apex Club plus-one name/phone.
-- Additive only: no existing table is touched.

CREATE TABLE IF NOT EXISTS vendor_services (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_services_contract_service
  ON vendor_services (contract_id, service_key) WHERE contract_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_services_vendor ON vendor_services (vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_services_client ON vendor_services (client_id);

CREATE TABLE IF NOT EXISTS vendor_payables (
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
);

CREATE INDEX IF NOT EXISTS idx_vendor_payables_vendor ON vendor_payables (vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_vendor_payables_client ON vendor_payables (client_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payables_period ON vendor_payables (period_month);
CREATE INDEX IF NOT EXISTS idx_vendor_payables_service ON vendor_payables (service_id);

CREATE TABLE IF NOT EXISTS vendor_payment_batches (
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
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_batches_vendor ON vendor_payment_batches (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_batches_txn ON vendor_payment_batches (transaction_id);

CREATE TABLE IF NOT EXISTS vendor_payment_allocations (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  payable_id TEXT NOT NULL,
  applied_cents INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_allocations_batch ON vendor_payment_allocations (batch_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_allocations_payable ON vendor_payment_allocations (payable_id);

CREATE TABLE IF NOT EXISTS vendor_ignored_transactions (
  transaction_id TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE apex_club_registrations ADD COLUMN plus_one_name TEXT;
ALTER TABLE apex_club_registrations ADD COLUMN plus_one_phone TEXT;
