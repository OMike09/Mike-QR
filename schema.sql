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
  extra_links JSONB NOT NULL DEFAULT '[]'::JSONB,
  style JSONB NOT NULL DEFAULT '{"foreground":"#173B32","background":"#FFFFFF","correction":"M"}'::JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
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
