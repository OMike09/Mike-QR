-- ============================================================================================
-- MISSION 7 — Consignation (bouteilles & monnaie), espace client, application installable,
--             et code marchand à 6 chiffres.
--
-- Migration STRICTEMENT ADDITIVE :
--   * aucune colonne existante n'est supprimée ni réécrite ;
--   * aucun compte, aucune commande, aucun QR code, aucun historique n'est touché ;
--   * les tables déjà en production restent la source des chiffres déjà affichés.
--
-- Conventions :
--   * tout est cloisonné par `store_id` + `merchant_id` (jamais fournis par le client, toujours
--     résolus depuis la session ou depuis le code secret) ;
--   * les soldes ne sont JAMAIS mis à jour par une écriture directe : ils sont recalculés par
--     agrégation des mouvements, qui sont eux-mêmes append-only ;
--   * un code secret n'est jamais stocké en clair (empreinte SHA-256 + suffixe non secret pour
--     l'affichage au personnel qui vient de le générer).
-- ============================================================================================

-- -------------------------------------------------------------------------------------------
-- 1. COMPTES MARCHANDS : code à 6 chiffres.
--    Aucune donnée n'est migrée de force : `password_hash` reste la seule source d'authentification.
--    On ajoute seulement la politique et le compteur d'échecs progressif.
-- -------------------------------------------------------------------------------------------
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS password_policy TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_accounts_password_policy_check' AND conrelid='merchant_accounts'::regclass) THEN
    ALTER TABLE merchant_accounts ADD CONSTRAINT merchant_accounts_password_policy_check
      CHECK (password_policy IN ('legacy','pin6'));
  END IF;
END;
$$;
-- Un code à 6 chiffres n'est acceptable que parce que les tentatives sont comptées par COMPTE
-- (et pas seulement par IP). Cet index sert la recherche par identifiant au login.
CREATE INDEX IF NOT EXISTS merchant_accounts_locked_idx ON merchant_accounts (locked_until) WHERE locked_until IS NOT NULL;

-- Journal dédié aux changements de code marchand (lisible par le PDG, jamais par le marchand).
CREATE TABLE IF NOT EXISTS merchant_password_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created_pin','changed_pin','reset_by_admin','failed_attempt','lockout','unlock','legacy_login')),
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('merchant','admin','manager','system')),
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_password_events_merchant_idx ON merchant_password_events (merchant_id, created_at DESC);

-- -------------------------------------------------------------------------------------------
-- 2. CATALOGUE DE CONSIGNATION, configuré PAR BOUTIQUE (valeurs libres, aucun barème imposé).
-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consign_bottle_types (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  unit_value_xof BIGINT NOT NULL DEFAULT 0 CHECK (unit_value_xof >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS consign_bottle_types_store_label_idx ON consign_bottle_types (store_id, LOWER(label));
CREATE INDEX IF NOT EXISTS consign_bottle_types_store_idx ON consign_bottle_types (store_id, active, sort_order);

-- Réglages de consignation par boutique (permissions accordées aux serveuses, devise, etc.).
CREATE TABLE IF NOT EXISTS consign_store_settings (
  store_id TEXT PRIMARY KEY REFERENCES merchant_stores(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'XOF',
  waitress_can_create_bottles BOOLEAN NOT NULL DEFAULT TRUE,
  waitress_can_create_money BOOLEAN NOT NULL DEFAULT TRUE,
  waitress_can_return BOOLEAN NOT NULL DEFAULT FALSE,
  waitress_can_refund BOOLEAN NOT NULL DEFAULT FALSE,
  require_phone_for_money BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------------------------------------------
-- 3. CONSIGNATIONS : une fiche = un dépôt, jamais réécrite. Le solde est la somme des mouvements.
-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consignments (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('bottle','money')),
  -- Code secret client : jamais en clair. L'empreinte est hachée avec un secret serveur (HMAC).
  code_hash TEXT NOT NULL,
  code_hint TEXT NOT NULL DEFAULT '',
  code_rotated_at TIMESTAMPTZ,
  code_attempt_count INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_phone_hash TEXT NOT NULL DEFAULT '',
  -- Bouteilles
  bottle_type_id TEXT,
  bottle_type_label TEXT NOT NULL DEFAULT '',
  bottle_reference TEXT NOT NULL DEFAULT '',
  quantity_deposited INTEGER NOT NULL DEFAULT 0 CHECK (quantity_deposited >= 0),
  unit_value_xof BIGINT NOT NULL DEFAULT 0 CHECK (unit_value_xof >= 0),
  -- Monnaie
  amount_deposited_xof BIGINT NOT NULL DEFAULT 0 CHECK (amount_deposited_xof >= 0),
  currency TEXT NOT NULL DEFAULT 'XOF',
  reason TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  -- Dénormalisations recalculées à chaque mouvement (jamais éditées à la main) :
  quantity_recovered INTEGER NOT NULL DEFAULT 0 CHECK (quantity_recovered >= 0),
  amount_used_xof BIGINT NOT NULL DEFAULT 0 CHECK (amount_used_xof >= 0),
  amount_refunded_xof BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded_xof >= 0),
  balance_quantity INTEGER NOT NULL DEFAULT 0 CHECK (balance_quantity >= 0),
  balance_amount_xof BIGINT NOT NULL DEFAULT 0 CHECK (balance_amount_xof >= 0),
  service_point_id TEXT,
  service_point_name TEXT NOT NULL DEFAULT '',
  created_by_type TEXT NOT NULL DEFAULT 'merchant' CHECK (created_by_type IN ('merchant','manager','staff','system')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  -- Une fiche bouteille porte des quantités, une fiche monnaie porte un montant : jamais les deux.
  CONSTRAINT consignments_kind_shape CHECK (
    (kind = 'bottle' AND quantity_deposited > 0 AND amount_deposited_xof = 0)
    OR (kind = 'money' AND amount_deposited_xof > 0 AND quantity_deposited = 0)
  ),
  CONSTRAINT consignments_balances CHECK (
    quantity_recovered <= quantity_deposited
    AND amount_used_xof + amount_refunded_xof <= amount_deposited_xof
  )
);
CREATE INDEX IF NOT EXISTS consignments_store_date_idx ON consignments (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS consignments_store_status_idx ON consignments (store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS consignments_phone_idx ON consignments (store_id, customer_phone_hash) WHERE customer_phone_hash <> '';
CREATE UNIQUE INDEX IF NOT EXISTS consignments_code_store_idx ON consignments (store_id, code_hash);

-- Mouvements : append-only. Aucune ligne n'est jamais supprimée ni éditée après création.
CREATE TABLE IF NOT EXISTS consignment_movements (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES consignments(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN
    ('deposit','return','use','refund','code_rotation','cancel','adjustment')),
  quantity_delta INTEGER NOT NULL DEFAULT 0,
  amount_delta_xof BIGINT NOT NULL DEFAULT 0,
  -- Pour un mouvement monétaire, le delta est négatif au débit du solde dû au client.
  balance_quantity_after INTEGER NOT NULL,
  balance_amount_after BIGINT NOT NULL,
  -- Clé d'idempotence : deux clics sur « Valider » ne créent jamais deux mouvements.
  idempotency_key TEXT NOT NULL,
  order_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  observation TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'merchant' CHECK (actor_type IN ('merchant','manager','staff','client','system')),
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS consignment_movements_idem_idx ON consignment_movements (consignment_id, idempotency_key);
CREATE INDEX IF NOT EXISTS consignment_movements_consignment_idx ON consignment_movements (consignment_id, created_at);
CREATE INDEX IF NOT EXISTS consignment_movements_store_date_idx ON consignment_movements (store_id, created_at DESC);

-- -------------------------------------------------------------------------------------------
-- 4. ESPACE CLIENT : identité par téléphone + code à usage unique, sessions révocables.
-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_accounts (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL UNIQUE,
  phone_last4 TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  notify_orders BOOLEAN NOT NULL DEFAULT TRUE,
  notify_consignments BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  token_version INTEGER NOT NULL DEFAULT 1,
  failed_otp_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_otp_codes (
  id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','consignment_lookup')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  requested_ip_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS client_otp_phone_idx ON client_otp_codes (phone_hash, created_at DESC);

-- Rattachement client <-> boutique : « boutiques déjà visitées ».
CREATE TABLE IF NOT EXISTS client_store_links (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE RESTRICT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, store_id)
);
CREATE INDEX IF NOT EXISTS client_store_links_client_idx ON client_store_links (client_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS client_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS client_sessions_client_idx ON client_sessions (client_id, created_at DESC);

-- Notifications client (réelles, persistées ; diffusées en SSE quand l'onglet est ouvert).
CREATE TABLE IF NOT EXISTS client_notifications (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  store_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  dedupe_key TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_notifications_dedupe_idx ON client_notifications (client_id, dedupe_key) WHERE dedupe_key <> '';
CREATE INDEX IF NOT EXISTS client_notifications_client_idx ON client_notifications (client_id, created_at DESC);

-- Rattachement d'une commande existante à un compte client (sans jamais réécrire la commande).
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS client_id TEXT;
CREATE INDEX IF NOT EXISTS merchant_orders_client_idx ON merchant_orders (client_id, created_at DESC) WHERE client_id IS NOT NULL;

-- -------------------------------------------------------------------------------------------
-- 5. ANNULATION CLIENT : traçabilité de l'origine (le circuit existant reste inchangé).
-- -------------------------------------------------------------------------------------------
ALTER TABLE merchant_order_cancellation_requests ADD COLUMN IF NOT EXISTS requested_by_type TEXT NOT NULL DEFAULT 'client';
ALTER TABLE merchant_order_cancellation_requests ADD COLUMN IF NOT EXISTS client_id TEXT;

-- -------------------------------------------------------------------------------------------
-- 6. SCANS CLIENTS : on distingue explicitement un scan client d'un scan marchand/personnel.
--    La contrainte existante de `merchant_scan_events` accepte déjà 'customer'.
-- -------------------------------------------------------------------------------------------
ALTER TABLE merchant_scan_events ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE merchant_scan_events ADD COLUMN IF NOT EXISTS surface TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_scan_events_client_idx ON merchant_scan_events (client_id, scanned_at DESC) WHERE client_id IS NOT NULL;

-- -------------------------------------------------------------------------------------------
-- 7. TRACES : chaque opération sensible de consignation est journalisée séparément.
-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consignment_events (
  id TEXT PRIMARY KEY,
  consignment_id TEXT NOT NULL REFERENCES consignments(id) ON DELETE RESTRICT,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS consignment_events_consignment_idx ON consignment_events (consignment_id, created_at DESC);
