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
  extra_links JSONB NOT NULL DEFAULT '[]'::JSONB,
  style JSONB NOT NULL DEFAULT '{"foreground":"#173B32","background":"#FFFFFF","correction":"M"}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS selected_photo_ids JSONB NOT NULL DEFAULT '[]'::JSONB;
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
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'blocked')),
  status_reason TEXT NOT NULL DEFAULT '',
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS managers_username_active_unique_idx ON managers (LOWER(username)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS managers_status_idx ON managers (status, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS owner_manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL;
ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL;
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
