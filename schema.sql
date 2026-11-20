CREATE TABLE IF NOT EXISTS qr_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('individual', 'business', 'commerce', 'organization', 'other')),
  name TEXT NOT NULL,
  logo TEXT NOT NULL DEFAULT '',
  photos JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  location_url TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  socials JSONB NOT NULL DEFAULT '[]'::JSONB,
  bio TEXT NOT NULL DEFAULT '',
  offers JSONB NOT NULL DEFAULT '[]'::JSONB,
  documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS client_request_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beneficiaries_status_check' AND conrelid = 'beneficiaries'::regclass) THEN
    ALTER TABLE beneficiaries ADD CONSTRAINT beneficiaries_status_check CHECK (status IN ('active', 'blocked'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS beneficiaries_status_active_name_idx ON beneficiaries (status, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS beneficiaries_name_idx ON beneficiaries USING GIN (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS beneficiaries_active_name_idx ON beneficiaries (name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  beneficiary_id TEXT NOT NULL REFERENCES beneficiaries(id),
  category_id TEXT REFERENCES qr_categories(id),
  purpose TEXT NOT NULL DEFAULT 'other',
  destination_type TEXT NOT NULL CHECK (destination_type IN ('page', 'redirect')),
  target_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  selected_fields JSONB NOT NULL DEFAULT '[]'::JSONB,
  selected_photo_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  photos JSONB NOT NULL DEFAULT '[]'::JSONB,
  profile_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  client_request_id TEXT,
  extra_links JSONB NOT NULL DEFAULT '[]'::JSONB,
  style JSONB NOT NULL DEFAULT '{"foreground":"#173B32","background":"#FFFFFF","correction":"M"}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted', 'draft', 'pending_validation', 'suspended', 'rejected')),
  status_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS selected_photo_ids JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS status_reason TEXT NOT NULL DEFAULT '';
-- Statuts enrichis pour le circuit de validation. Conserve les anciennes valeurs `inactive` et `deleted`.
DO $$
BEGIN
  ALTER TABLE qr_codes DROP CONSTRAINT IF EXISTS qr_codes_status_check;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'qr_codes_status_workflow_check' AND conrelid = 'qr_codes'::regclass
  ) THEN
    ALTER TABLE qr_codes ADD CONSTRAINT qr_codes_status_workflow_check
      CHECK (status IN ('active', 'inactive', 'deleted', 'draft', 'pending_validation', 'suspended', 'rejected'));
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS qr_codes_beneficiary_idx ON qr_codes (beneficiary_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qr_codes_category_idx ON qr_codes (category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qr_codes_status_idx ON qr_codes (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qr_codes_created_idx ON qr_codes (created_at DESC);
CREATE INDEX IF NOT EXISTS qr_codes_public_code_idx ON qr_codes (public_code);

CREATE TABLE IF NOT EXISTS qr_scans (
  id BIGSERIAL PRIMARY KEY,
  qr_code_id TEXT NOT NULL REFERENCES qr_codes(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qr_scans_code_date_idx ON qr_scans (qr_code_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS qr_scans_date_idx ON qr_scans (scanned_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('defaultPublicTextSize', '"normal"'::JSONB)
ON CONFLICT (setting_key) DO NOTHING;

-- Comptes gestionnaires, attribution des QR et journal d'activité enrichi.
-- Toutes les modifications sont idempotentes pour ne pas toucher aux données existantes.
CREATE TABLE IF NOT EXISTS managers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  custom_domain TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'blocked')),
  status_reason TEXT NOT NULL DEFAULT '',
  can_create_codes BOOLEAN NOT NULL DEFAULT TRUE,
  can_edit_codes BOOLEAN NOT NULL DEFAULT TRUE,
  can_self_activate_codes BOOLEAN NOT NULL DEFAULT FALSE,
  qr_limit INTEGER NOT NULL DEFAULT 0 CHECK (qr_limit >= 0),
  notification_preferences JSONB NOT NULL DEFAULT '{"codeUpdates":true,"validationResults":true,"suspensions":true,"pdgMessages":true,"securityAlerts":true}'::JSONB,
  token_version INTEGER NOT NULL DEFAULT 1,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  password_reset_token_hash TEXT NOT NULL DEFAULT '',
  password_reset_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_create_codes BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_edit_codes BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_self_activate_codes BOOLEAN;
-- Les comptes préexistants avaient déjà le droit de publier leurs QR; les conserver,
-- tout en mettant les nouveaux comptes en validation PDG par défaut.
UPDATE managers SET can_self_activate_codes=TRUE WHERE can_self_activate_codes IS NULL;
ALTER TABLE managers ALTER COLUMN can_self_activate_codes SET DEFAULT FALSE;
ALTER TABLE managers ALTER COLUMN can_self_activate_codes SET NOT NULL;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS qr_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{"codeUpdates":true,"validationResults":true,"suspensions":true,"pdgMessages":true,"securityAlerts":true}'::JSONB;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='managers_qr_limit_nonnegative_check' AND conrelid='managers'::regclass) THEN
    ALTER TABLE managers ADD CONSTRAINT managers_qr_limit_nonnegative_check CHECK (qr_limit >= 0);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS manager_notifications (
  id TEXT PRIMARY KEY,
  manager_id TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS manager_notifications_owner_created_idx ON manager_notifications (manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS manager_notifications_owner_unread_idx ON manager_notifications (manager_id, created_at DESC) WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS managers_username_active_unique_idx ON managers (LOWER(username)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS managers_status_idx ON managers (status, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS owner_manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS beneficiaries_manager_request_idx ON beneficiaries (owner_manager_id, client_request_id) WHERE owner_manager_id IS NOT NULL AND client_request_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS beneficiaries_admin_request_idx ON beneficiaries (client_request_id) WHERE owner_manager_id IS NULL AND client_request_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS qr_codes_manager_request_idx ON qr_codes (manager_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS qr_codes_admin_request_idx ON qr_codes (client_request_id) WHERE manager_id IS NULL AND client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS beneficiaries_manager_idx ON beneficiaries (owner_manager_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS qr_codes_manager_idx ON qr_codes (manager_id, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS manager_id TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT 'success';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB;
CREATE INDEX IF NOT EXISTS audit_logs_manager_idx ON audit_logs (manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_type_idx ON audit_logs (actor_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_result_idx ON audit_logs (action, result, created_at DESC);

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('managerActivityAlerts', '{"loginFailures":true,"loginSuccesses":false,"statusChanges":true,"qrChanges":true,"authorizationDenials":true,"accountChanges":true}'::JSONB)
ON CONFLICT (setting_key) DO NOTHING;

-- Avant d'activer l'append-only, assainir les instantanés historiques issus de l'ancienne version
-- (URLs complètes et coordonnées) sans supprimer les événements ni leurs résumés.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_logs_append_only' AND tgrelid = 'audit_logs'::regclass AND NOT tgisinternal
  ) THEN
    UPDATE audit_logs SET
      before_data = CASE
        WHEN jsonb_typeof(before_data) = 'object' AND entity_type = 'qr_code'
          THEN before_data - ARRAY['targetUrl','contentText','description','extraLinks']::TEXT[]
        WHEN jsonb_typeof(before_data) = 'object' AND entity_type = 'beneficiary'
          THEN before_data - ARRAY['phone','whatsapp','email','address','locationUrl','website','socials','bio','offers','documents','logo','photos']::TEXT[]
        ELSE before_data END,
      after_data = CASE
        WHEN jsonb_typeof(after_data) = 'object' AND entity_type = 'qr_code'
          THEN after_data - ARRAY['targetUrl','contentText','description','extraLinks']::TEXT[]
        WHEN jsonb_typeof(after_data) = 'object' AND entity_type = 'beneficiary'
          THEN after_data - ARRAY['phone','whatsapp','email','address','locationUrl','website','socials','bio','offers','documents','logo','photos']::TEXT[]
        ELSE after_data END
    WHERE (entity_type = 'qr_code' AND (before_data ?| ARRAY['targetUrl','contentText','description','extraLinks'] OR after_data ?| ARRAY['targetUrl','contentText','description','extraLinks']))
       OR (entity_type = 'beneficiary' AND (before_data ?| ARRAY['phone','whatsapp','email','address','locationUrl','website','socials','bio','offers','documents','logo','photos'] OR after_data ?| ARRAY['phone','whatsapp','email','address','locationUrl','website','socials','bio','offers','documents','logo','photos']));
  END IF;
END;
$$;

-- Le journal est append-only pour les rôles applicatifs. L'archivage doit se faire par export/backup,
-- ou par une opération DBA explicite après copie vérifiée, pas par l'interface.
CREATE OR REPLACE FUNCTION qria_prevent_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_logs_append_only' AND tgrelid = 'audit_logs'::regclass AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER audit_logs_append_only
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION qria_prevent_audit_mutation();
  END IF;
END;
$$;

-- Profils d'installation personnalisés des gestionnaires. install_token n'accorde aucun accès authentifié.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS avatar_data TEXT NOT NULL DEFAULT '';
ALTER TABLE managers ADD COLUMN IF NOT EXISTS install_token TEXT NOT NULL DEFAULT '';
ALTER TABLE managers ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE managers ADD COLUMN IF NOT EXISTS custom_domain TEXT NOT NULL DEFAULT '';
ALTER TABLE managers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE managers ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
UPDATE managers SET install_token = md5(id || random()::text || clock_timestamp()::text) WHERE install_token = '';
CREATE UNIQUE INDEX IF NOT EXISTS managers_install_token_unique_idx ON managers (install_token);
CREATE UNIQUE INDEX IF NOT EXISTS managers_reset_token_unique_idx ON managers (password_reset_token_hash) WHERE password_reset_token_hash <> '';
CREATE UNIQUE INDEX IF NOT EXISTS managers_custom_domain_unique_idx ON managers (LOWER(custom_domain)) WHERE custom_domain <> '' AND deleted_at IS NULL;

-- Tarifs et paiements : les montants sont des entiers XOF. Les lignes financières conservent le prix au moment de la commande.
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('financePricing', '[]'::JSONB)
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS qr_orders (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  qr_code_id TEXT REFERENCES qr_codes(id) ON DELETE SET NULL,
  manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL,
  manager_name TEXT NOT NULL DEFAULT 'PDG',
  beneficiary_id TEXT REFERENCES beneficiaries(id) ON DELETE SET NULL,
  beneficiary_name TEXT NOT NULL,
  client_name TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  customer_type TEXT NOT NULL CHECK (customer_type IN ('individual', 'business', 'custom')),
  qr_purpose TEXT NOT NULL,
  destination_type TEXT NOT NULL CHECK (destination_type IN ('page', 'redirect')),
  pricing_plan_id TEXT,
  pricing_plan_name TEXT NOT NULL,
  unit_amount_xof BIGINT NOT NULL CHECK (unit_amount_xof >= 0),
  selected_options JSONB NOT NULL DEFAULT '[]'::JSONB,
  total_amount_xof BIGINT NOT NULL CHECK (total_amount_xof >= 0),
  original_total_amount_xof BIGINT NOT NULL CHECK (original_total_amount_xof >= 0),
  currency TEXT NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'electronic')),
  order_state TEXT NOT NULL DEFAULT 'open' CHECK (order_state IN ('open', 'cancelled')),
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('admin', 'manager')),
  created_by_id TEXT,
  correction_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qr_orders_created_idx ON qr_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS qr_orders_manager_idx ON qr_orders (manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_orders_beneficiary_idx ON qr_orders (beneficiary_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_orders_qr_idx ON qr_orders (qr_code_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_orders_state_idx ON qr_orders (order_state, created_at DESC);

CREATE TABLE IF NOT EXISTS qr_payment_entries (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES qr_orders(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('receipt', 'refund')),
  method TEXT NOT NULL CHECK (method IN ('cash', 'mobile_money', 'bank_transfer', 'card', 'other')),
  amount_xof BIGINT NOT NULL CHECK (amount_xof > 0),
  currency TEXT NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
  client_name TEXT NOT NULL,
  receipt_reference TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL,
  declared_by_type TEXT NOT NULL CHECK (declared_by_type IN ('admin', 'manager', 'provider')),
  declared_by_id TEXT,
  provider_name TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  reviewed_by_type TEXT,
  reviewed_by_id TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE qr_payment_entries ADD COLUMN IF NOT EXISTS receipt_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE qr_payment_entries ADD COLUMN IF NOT EXISTS observation TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS qr_payment_order_idx ON qr_payment_entries (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_payment_status_idx ON qr_payment_entries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_payment_method_idx ON qr_payment_entries (method, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS qr_payment_provider_reference_unique_idx ON qr_payment_entries (provider_name, provider_reference)
  WHERE provider_reference <> '';

CREATE TABLE IF NOT EXISTS qr_finance_events (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES qr_orders(id) ON DELETE RESTRICT,
  payment_id TEXT REFERENCES qr_payment_entries(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'manager', 'provider', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS qr_finance_events_order_idx ON qr_finance_events (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS qr_finance_events_payment_idx ON qr_finance_events (payment_id, created_at DESC);

CREATE OR REPLACE FUNCTION qria_prevent_finance_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'qr_finance_events is append-only';
END;
$$ LANGUAGE plpgsql;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'qr_finance_events_append_only' AND tgrelid = 'qr_finance_events'::regclass AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER qr_finance_events_append_only
      BEFORE UPDATE OR DELETE ON qr_finance_events
      FOR EACH ROW EXECUTE FUNCTION qria_prevent_finance_event_mutation();
  END IF;
END;
$$;

-- Merchant accounts and commerce. New tables are additive; existing QR, manager and finance records are untouched.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_manage_merchants BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS merchant_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','blocked')),
  status_reason TEXT NOT NULL DEFAULT '',
  manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  password_reset_token_hash TEXT NOT NULL DEFAULT '',
  password_reset_expires_at TIMESTAMPTZ,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_accounts_username_unique_idx ON merchant_accounts (LOWER(username)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS merchant_accounts_manager_idx ON merchant_accounts (manager_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS merchant_accounts_status_idx ON merchant_accounts (status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS merchant_stores (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  delivery_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  qr_public_code TEXT UNIQUE,
  qr_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  qr_scan_count BIGINT NOT NULL DEFAULT 0 CHECK (qr_scan_count >= 0),
  last_qr_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS merchant_stores_public_idx ON merchant_stores (slug) WHERE status='active' AND is_published=TRUE;

CREATE TABLE IF NOT EXISTS merchant_products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price_xof BIGINT NOT NULL DEFAULT 0 CHECK (price_xof >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  track_stock BOOLEAN NOT NULL DEFAULT TRUE,
  image_data TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unavailable','archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_products_store_idx ON merchant_products (store_id, status, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_products_sku_unique_idx ON merchant_products (store_id, LOWER(sku)) WHERE sku <> '' AND status <> 'archived';

CREATE TABLE IF NOT EXISTS merchant_manager_assignments (
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  can_manage_store BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_products BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_orders BOOLEAN NOT NULL DEFAULT FALSE,
  can_create_store_qr BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_audit BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, merchant_id)
);
CREATE INDEX IF NOT EXISTS merchant_assignments_merchant_idx ON merchant_manager_assignments (merchant_id, manager_id);

CREATE TABLE IF NOT EXISTS merchant_orders (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  public_reference TEXT NOT NULL UNIQUE,
  client_request_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  tracking_token_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  delivery_address TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  total_amount_xof BIGINT NOT NULL CHECK (total_amount_xof >= 0),
  currency TEXT NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','preparing','ready','completed','cancelled')),
  stock_reserved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_orders_store_request_idx ON merchant_orders (store_id, client_request_id);
CREATE INDEX IF NOT EXISTS merchant_orders_merchant_date_idx ON merchant_orders (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS merchant_orders_store_status_date_idx ON merchant_orders (store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS merchant_orders_tracking_token_store_active_idx ON merchant_orders (store_id, tracking_token_hash) WHERE status NOT IN ('completed','cancelled');

CREATE TABLE IF NOT EXISTS merchant_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES merchant_orders(id) ON DELETE CASCADE,
  product_id TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_xof BIGINT NOT NULL CHECK (unit_price_xof >= 0),
  image_data TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS merchant_order_items_order_idx ON merchant_order_items (order_id);

CREATE TABLE IF NOT EXISTS merchant_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES merchant_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','preparing','ready','completed','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_order_events_order_date_idx ON merchant_order_events (order_id, created_at);

-- Add the optional delivery stage without disturbing any historical order/event rows.
ALTER TABLE merchant_orders DROP CONSTRAINT IF EXISTS merchant_orders_status_check;
ALTER TABLE merchant_order_events DROP CONSTRAINT IF EXISTS merchant_order_events_status_check;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_status_workflow_check' AND conrelid='merchant_orders'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%rejected%') THEN
    ALTER TABLE merchant_orders DROP CONSTRAINT merchant_orders_status_workflow_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_order_events_status_workflow_check' AND conrelid='merchant_order_events'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%rejected%') THEN
    ALTER TABLE merchant_order_events DROP CONSTRAINT merchant_order_events_status_workflow_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_status_workflow_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_status_workflow_check
      CHECK (status IN ('pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_order_events_status_workflow_check' AND conrelid='merchant_order_events'::regclass) THEN
    ALTER TABLE merchant_order_events ADD CONSTRAINT merchant_order_events_status_workflow_check
      CHECK (status IN ('pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled','rejected'));
  END IF;
END;
$$;

-- Merchant profile media, presentation settings and durable notifications (additive).
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS cover_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS theme JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS opening_hours JSONB NOT NULL DEFAULT '{}'::JSONB;
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS pickup_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS delivery_fee_xof BIGINT NOT NULL DEFAULT 0;
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS accepts_orders BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS compare_at_price_xof BIGINT;
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS merchant_media (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 358400),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_media_owner_idx ON merchant_media (merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS merchant_notifications (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES merchant_orders(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE (merchant_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS merchant_notifications_unread_idx ON merchant_notifications (merchant_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS merchant_notifications_order_idx ON merchant_notifications (merchant_id, order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS merchant_push_subscriptions (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_push_owner_idx ON merchant_push_subscriptions (merchant_id);

-- Sector profile and table/service-point QR codes. All changes are additive; existing printed store QR links are untouched.
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS sector TEXT NOT NULL DEFAULT 'general';
CREATE TABLE IF NOT EXISTS merchant_service_points (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  point_type TEXT NOT NULL CHECK (point_type IN ('table','counter','location','salon')),
  name TEXT NOT NULL,
  zone TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  public_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  qr_scan_count BIGINT NOT NULL DEFAULT 0 CHECK (qr_scan_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Extend the existing service-point constraint without changing any existing type values.
ALTER TABLE merchant_service_points DROP CONSTRAINT IF EXISTS merchant_service_points_point_type_check;
ALTER TABLE merchant_service_points ADD CONSTRAINT merchant_service_points_point_type_check
  CHECK (point_type IN ('table','counter','location','salon'));
CREATE INDEX IF NOT EXISTS merchant_service_points_store_idx ON merchant_service_points (store_id, status, created_at);
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS service_point_id TEXT;
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS service_point_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_orders_service_point_idx ON merchant_orders (service_point_id, created_at DESC) WHERE service_point_id IS NOT NULL;

-- Merchant-owned announcement campaigns with a same-store destination only.
CREATE TABLE IF NOT EXISTS merchant_ad_campaigns (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS merchant_ad_campaigns_public_idx ON merchant_ad_campaigns (store_id, status, starts_at, ends_at);

-- Free promotional rewards only; entry fee is hard-constrained to zero at the database layer.
CREATE TABLE IF NOT EXISTS merchant_reward_campaigns (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  entry_fee_xof BIGINT NOT NULL DEFAULT 0 CHECK (entry_fee_xof = 0),
  max_participants INTEGER NOT NULL CHECK (max_participants > 0),
  remaining_participants INTEGER NOT NULL CHECK (remaining_participants >= 0),
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused')),
  regulatory_authorization_reference TEXT NOT NULL DEFAULT '',
  regulatory_authorization_status TEXT NOT NULL DEFAULT 'not_submitted',
  regulatory_authorization_reviewed_at TIMESTAMPTZ,
  regulatory_authorization_reviewed_by TEXT NOT NULL DEFAULT '',
  regulatory_authorization_review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (remaining_participants <= max_participants)
);
CREATE INDEX IF NOT EXISTS merchant_reward_campaigns_public_idx ON merchant_reward_campaigns (store_id, status, starts_at, ends_at);
CREATE TABLE IF NOT EXISTS merchant_reward_prizes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES merchant_reward_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  prize_kind TEXT NOT NULL CHECK (prize_kind IN ('benefit','no_prize')),
  weight INTEGER NOT NULL CHECK (weight > 0),
  quantity_total INTEGER NOT NULL CHECK (quantity_total >= 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_total),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_reward_prizes_campaign_idx ON merchant_reward_prizes (campaign_id, id);
CREATE TABLE IF NOT EXISTS merchant_reward_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES merchant_reward_campaigns(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  participant_hash TEXT NOT NULL,
  claim_request_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_encrypted TEXT NOT NULL,
  code_last4 TEXT NOT NULL,
  prize_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','expired')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  UNIQUE (campaign_id, participant_hash),
  UNIQUE (campaign_id, claim_request_hash)
);
CREATE INDEX IF NOT EXISTS merchant_reward_claims_store_idx ON merchant_reward_claims (store_id, issued_at DESC);

-- Gift values are not redeemable until a merchant records offline receipt/authorization; no payment is processed here.
CREATE TABLE IF NOT EXISTS merchant_gift_cards (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  issue_request_hash TEXT NOT NULL,
  issue_intent_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_encrypted TEXT NOT NULL,
  code_last4 TEXT NOT NULL,
  face_value_xof BIGINT NOT NULL CHECK (face_value_xof > 0),
  balance_xof BIGINT NOT NULL CHECK (balance_xof >= 0 AND balance_xof <= face_value_xof),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','redeemed','cancelled')),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, issue_request_hash)
);
CREATE INDEX IF NOT EXISTS merchant_gift_cards_store_idx ON merchant_gift_cards (store_id, created_at DESC);
CREATE TABLE IF NOT EXISTS merchant_gift_card_redemptions (
  id TEXT PRIMARY KEY,
  gift_card_id TEXT NOT NULL REFERENCES merchant_gift_cards(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  amount_xof BIGINT NOT NULL CHECK (amount_xof > 0),
  reference TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, request_hash)
);
CREATE INDEX IF NOT EXISTS merchant_gift_redemptions_card_idx ON merchant_gift_card_redemptions (gift_card_id, created_at DESC);

-- Idempotency keys make retries safe after intermittent connections; all columns are nullable/additive for existing rows.
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS create_request_hash TEXT;
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS create_intent_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS merchant_ad_campaigns_create_request_idx ON merchant_ad_campaigns (store_id,create_request_hash) WHERE create_request_hash IS NOT NULL;
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS destination TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS cta_label TEXT NOT NULL DEFAULT 'Découvrir';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS display_format TEXT NOT NULL DEFAULT 'card';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'ltr';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS speed INTEGER NOT NULL DEFAULT 30 CHECK (speed BETWEEN 5 AND 60);
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS placement TEXT NOT NULL DEFAULT 'after_intro';
ALTER TABLE merchant_ad_campaigns ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_ad_campaigns_status_check' AND conrelid='merchant_ad_campaigns'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%draft%') THEN
    ALTER TABLE merchant_ad_campaigns DROP CONSTRAINT merchant_ad_campaigns_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_ad_campaigns_status_check' AND conrelid='merchant_ad_campaigns'::regclass) THEN
    ALTER TABLE merchant_ad_campaigns ADD CONSTRAINT merchant_ad_campaigns_status_check CHECK (status IN ('draft','active','paused','archived'));
  END IF;
END;
$$;
ALTER TABLE merchant_ad_campaigns ALTER COLUMN status SET DEFAULT 'draft';
CREATE TABLE IF NOT EXISTS merchant_ad_events (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES merchant_ad_campaigns(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression','click')),
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id,event_type,event_hash)
);
CREATE INDEX IF NOT EXISTS merchant_ad_events_campaign_date_idx ON merchant_ad_events (campaign_id,event_type,created_at DESC);
ALTER TABLE merchant_service_points ADD COLUMN IF NOT EXISTS create_request_hash TEXT;
ALTER TABLE merchant_service_points ADD COLUMN IF NOT EXISTS create_intent_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS merchant_service_points_create_request_idx ON merchant_service_points (store_id,create_request_hash) WHERE create_request_hash IS NOT NULL;
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS create_request_hash TEXT;
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS create_intent_hash TEXT;
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS regulatory_authorization_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS regulatory_authorization_status TEXT NOT NULL DEFAULT 'not_submitted';
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS regulatory_authorization_reviewed_at TIMESTAMPTZ;
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS regulatory_authorization_reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS regulatory_authorization_review_note TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS merchant_reward_campaigns_create_request_idx ON merchant_reward_campaigns (store_id,create_request_hash) WHERE create_request_hash IS NOT NULL;
ALTER TABLE merchant_reward_campaigns ADD COLUMN IF NOT EXISTS service_point_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_reward_campaigns_service_point_fk' AND conrelid='merchant_reward_campaigns'::regclass) THEN
    ALTER TABLE merchant_reward_campaigns ADD CONSTRAINT merchant_reward_campaigns_service_point_fk FOREIGN KEY (service_point_id) REFERENCES merchant_service_points(id) ON DELETE SET NULL;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS merchant_reward_campaigns_service_point_idx ON merchant_reward_campaigns (service_point_id) WHERE service_point_id IS NOT NULL;


-- Restaurant table-photo policy and private order evidence (additive; at-rest encryption depends on deployment configuration).
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS require_table_photo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS merchant_order_photos (
  order_id TEXT PRIMARY KEY REFERENCES merchant_orders(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 307200),
  content BYTEA,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by_type TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  CHECK (deleted_at IS NOT NULL OR content IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS merchant_order_photos_retention_idx ON merchant_order_photos (expires_at) WHERE deleted_at IS NULL;
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS delivery_fee_xof BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_xof >= 0);
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS discount_amount_xof BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount_xof >= 0);
-- Assisted merchant entry reuses the existing order/inventory/event tables and never marks a payment as received.
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'customer_qr';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS created_by_id TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'not_recorded';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_source_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_source_check CHECK (source IN ('customer_qr','merchant_assisted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_created_by_type_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_created_by_type_check CHECK (created_by_type IN ('customer','merchant','manager','admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_order_type_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_order_type_check CHECK (order_type IN ('dine_in','pickup','delivery','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_payment_method_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_payment_method_check CHECK (payment_method IN ('not_recorded','cash','mobile_money','bank_transfer','card','other'));
  END IF;
END;
$$;

-- Cancellation requests are append-preserving for client/merchant/CEO audit history.
CREATE TABLE IF NOT EXISTS merchant_order_cancellation_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES merchant_orders(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  decision_note TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  decided_by_type TEXT NOT NULL DEFAULT '',
  decided_by TEXT NOT NULL DEFAULT '',
  UNIQUE (order_id, request_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_order_cancellation_one_pending_idx ON merchant_order_cancellation_requests (order_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS merchant_order_cancellation_store_date_idx ON merchant_order_cancellation_requests (store_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS merchant_order_cancellation_order_date_idx ON merchant_order_cancellation_requests (order_id, requested_at DESC);

-- Store-scoped customer blocks use keyed phone fingerprints; raw customer numbers are not duplicated here.
CREATE TABLE IF NOT EXISTS merchant_customer_blocks (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  phone_hash TEXT NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  phone_last4 TEXT NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 4),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unblocked')),
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('merchant','manager','admin')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unblocked_at TIMESTAMPTZ,
  unblocked_by_type TEXT NOT NULL DEFAULT '',
  unblocked_by TEXT NOT NULL DEFAULT '',
  unblock_reason TEXT NOT NULL DEFAULT '',
  CHECK ((status='active' AND unblocked_at IS NULL) OR (status='unblocked' AND unblocked_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_customer_blocks_active_phone_idx ON merchant_customer_blocks (store_id,phone_hash) WHERE status='active';
CREATE INDEX IF NOT EXISTS merchant_customer_blocks_store_status_date_idx ON merchant_customer_blocks (store_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS merchant_customer_blocks_merchant_date_idx ON merchant_customer_blocks (merchant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS merchant_customer_block_events (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES merchant_customer_blocks(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('blocked','unblocked')),
  reason TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL CHECK (actor_type IN ('merchant','manager','admin')),
  actor_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_customer_block_events_history_idx ON merchant_customer_block_events (block_id,created_at);
CREATE TABLE IF NOT EXISTS merchant_customer_block_attempts (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL REFERENCES merchant_customer_blocks(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  phone_hash TEXT NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  ip_hash TEXT NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id,request_hash)
);
CREATE INDEX IF NOT EXISTS merchant_customer_block_attempts_history_idx ON merchant_customer_block_attempts (block_id,attempted_at DESC);
CREATE INDEX IF NOT EXISTS merchant_customer_block_attempts_store_idx ON merchant_customer_block_attempts (store_id,attempted_at DESC);

-- Supplier marketplace and procurement. These records remain separate from customer sales/orders and payment ledgers.
CREATE TABLE IF NOT EXISTS supplier_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  categories JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(categories)='array'),
  public_contact BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','rejected')),
  status_reason TEXT NOT NULL DEFAULT '',
  public_code TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT NOT NULL DEFAULT '',
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_accounts_username_unique_idx ON supplier_accounts (LOWER(username)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS supplier_accounts_status_idx ON supplier_accounts (status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS supplier_accounts_categories_gin_idx ON supplier_accounts USING GIN (categories);

CREATE TABLE IF NOT EXISTS supplier_products (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES supplier_accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unité',
  price_xof BIGINT NOT NULL CHECK (price_xof > 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  minimum_order_quantity INTEGER NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unavailable','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supplier_products_supplier_idx ON supplier_products (supplier_id,status,updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_products_sku_unique_idx ON supplier_products (supplier_id,LOWER(sku)) WHERE sku<>'' AND status<>'archived';

CREATE TABLE IF NOT EXISTS sourcing_requests (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  buyer_merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  target_supplier_id TEXT REFERENCES supplier_accounts(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items)='array'),
  delivery_address TEXT NOT NULL DEFAULT '',
  wanted_by TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','awarded','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sourcing_requests_buyer_idx ON sourcing_requests (buyer_merchant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS sourcing_requests_supplier_idx ON sourcing_requests (target_supplier_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS sourcing_requests_category_idx ON sourcing_requests (LOWER(category),status,created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES sourcing_requests(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES supplier_accounts(id) ON DELETE RESTRICT,
  items JSONB NOT NULL CHECK (jsonb_typeof(items)='array'),
  total_xof BIGINT NOT NULL CHECK (total_xof > 0),
  notes TEXT NOT NULL DEFAULT '',
  valid_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','not_selected','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (request_id,supplier_id)
);
CREATE INDEX IF NOT EXISTS supplier_quotes_request_idx ON supplier_quotes (request_id,status,created_at);
CREATE INDEX IF NOT EXISTS supplier_quotes_supplier_idx ON supplier_quotes (supplier_id,created_at DESC);

CREATE TABLE IF NOT EXISTS supply_orders (
  id TEXT PRIMARY KEY,
  order_reference TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL REFERENCES sourcing_requests(id) ON DELETE RESTRICT,
  quote_id TEXT NOT NULL UNIQUE REFERENCES supplier_quotes(id) ON DELETE RESTRICT,
  buyer_merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES supplier_accounts(id) ON DELETE RESTRICT,
  items JSONB NOT NULL CHECK (jsonb_typeof(items)='array'),
  total_xof BIGINT NOT NULL CHECK (total_xof > 0),
  delivery_address TEXT NOT NULL DEFAULT '',
  tracking_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending_supplier' CHECK (status IN ('pending_supplier','confirmed','processing','shipped','delivered','received','cancelled','disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supply_orders_buyer_idx ON supply_orders (buyer_merchant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS supply_orders_supplier_idx ON supply_orders (supplier_id,created_at DESC);

CREATE TABLE IF NOT EXISTS supply_order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES supply_orders(id) ON DELETE RESTRICT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('merchant','supplier','admin')),
  actor_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  tracking_reference TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supply_order_events_order_idx ON supply_order_events (order_id,created_at);
CREATE TABLE IF NOT EXISTS supply_notifications (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('merchant','supplier')),
  actor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS supply_notifications_actor_idx ON supply_notifications (actor_type,actor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS supply_order_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES supply_orders(id) ON DELETE RESTRICT,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('merchant','supplier')),
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 2 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS supply_order_messages_history_idx ON supply_order_messages (order_id,created_at);

-- Self-service password reset requests for merchant accounts (additive, existing accounts untouched).
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMPTZ;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS password_reset_request_ip_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_accounts_reset_requested_idx ON merchant_accounts (password_reset_requested_at DESC) WHERE password_reset_requested_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS merchant_accounts_reset_token_idx ON merchant_accounts (password_reset_token_hash) WHERE password_reset_token_hash <> '';
