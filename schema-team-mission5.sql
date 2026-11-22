-- ============================================================================================
-- MISSION 5 — Prompt 2/3 : équipes marchandes, gérants généraux et serveuses
-- Migration ADDITIVE et REJOUABLE. Aucune suppression, aucune colonne existante modifiée.
--
--   team_members          membres d'équipe rattachés à UN marchand (gérant général / serveuse)
--   team_member_sessions  sessions opaques (jeton haché), révocables instantanément
--   team_activation_codes codes uniques à usage unique, expirables, révocables
--   team_permissions      catalogue des permissions connues (référentiel, pas un droit)
--   team_tasks            tâches attribuées (titre, échéance, priorité, statut, historique)
--   team_task_events      historique immuable des tâches
--   team_activity_events  journal d'activité des membres (connexions, commandes, scans…)
--   merchant_team_settings paramètres d'équipe propres au marchand (expiration des codes, limites)
-- ============================================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  -- Rôle fonctionnel : jamais modifiable par le membre lui-même.
  role TEXT NOT NULL CHECK (role IN ('general_manager','waitress')),
  -- Désignation interne libre : « Gérant 1 », « Serveuse 3 »… modifiable à tout moment.
  designation TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  permissions JSONB NOT NULL DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','blocked','suspended','archived')),
  status_reason TEXT NOT NULL DEFAULT '',
  -- Incrémenté à chaque blocage/retrait de permission : invalide les sessions ouvertes.
  token_version INTEGER NOT NULL DEFAULT 1,
  points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_by_type TEXT NOT NULL DEFAULT 'merchant',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_members_merchant_username_idx ON team_members (merchant_id, LOWER(username));
-- Un identifiant de connexion est unique pour toute la plateforme : aucune collision entre boutiques.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_username_global_idx ON team_members (LOWER(username)) WHERE status <> 'archived';
CREATE INDEX IF NOT EXISTS team_members_merchant_status_idx ON team_members (merchant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS team_members_store_idx ON team_members (store_id, role, status);

CREATE TABLE IF NOT EXISTS team_activation_codes (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('general_manager','waitress')),
  -- Seul le HACHAGE est stocké : un code en clair ne doit jamais être relu depuis la base.
  code_hash TEXT NOT NULL UNIQUE,
  -- 6 derniers caractères pour permettre au marchand de reconnaître un code qu'il a transmis.
  code_hint TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_activation_codes_member_idx ON team_activation_codes (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_activation_codes_open_idx ON team_activation_codes (expires_at) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS team_member_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS team_member_sessions_member_idx ON team_member_sessions (member_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS team_permissions (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  applies_to TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('both','general_manager','waitress')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS team_tasks (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled')),
  due_at TIMESTAMPTZ,
  created_by_type TEXT NOT NULL DEFAULT 'merchant' CHECK (created_by_type IN ('merchant','general_manager','admin')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_label TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_tasks_member_status_idx ON team_tasks (member_id, status, due_at);
CREATE INDEX IF NOT EXISTS team_tasks_store_idx ON team_tasks (store_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS team_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES team_tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_task_events_task_idx ON team_task_events (task_id, created_at);

CREATE TABLE IF NOT EXISTS team_activity_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','denied')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_activity_member_date_idx ON team_activity_events (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_activity_store_date_idx ON team_activity_events (store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS merchant_team_settings (
  merchant_id TEXT PRIMARY KEY REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  activation_code_ttl_hours INTEGER NOT NULL DEFAULT 72 CHECK (activation_code_ttl_hours BETWEEN 1 AND 720),
  max_general_managers INTEGER NOT NULL DEFAULT 10 CHECK (max_general_managers BETWEEN 0 AND 200),
  max_waitresses INTEGER NOT NULL DEFAULT 50 CHECK (max_waitresses BETWEEN 0 AND 500),
  -- Remise maximale qu'une serveuse peut accorder, en pourcentage du total (0 = aucune remise).
  waitress_max_discount_percent INTEGER NOT NULL DEFAULT 0 CHECK (waitress_max_discount_percent BETWEEN 0 AND 100),
  -- Prix libre (article hors catalogue) : autorisé ou non, avec un plafond unitaire.
  allow_free_price BOOLEAN NOT NULL DEFAULT TRUE,
  free_price_max_xof BIGINT NOT NULL DEFAULT 100000 CHECK (free_price_max_xof >= 0),
  team_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Commandes : traçabilité du membre qui a enregistré la commande (append-only, aucune réécriture).
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS created_by_member_id TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS created_by_designation TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_orders_member_idx ON merchant_orders (created_by_member_id, created_at DESC) WHERE created_by_member_id <> '';

-- Ligne de commande saisie librement : marquée comme telle, jamais poussée au catalogue.
ALTER TABLE merchant_order_items ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE merchant_order_items ADD COLUMN IF NOT EXISTS custom_note TEXT NOT NULL DEFAULT '';

-- Dérives corrigées : colonnes lues et écrites par merchant-commerce.js, absentes de schema.sql.
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS activity_domains JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS activity_domain_label TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_recorded';

-- Scans : identification du membre auteur du scan.
ALTER TABLE merchant_scan_events ADD COLUMN IF NOT EXISTS member_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_scan_events_member_idx ON merchant_scan_events (member_id, scanned_at DESC) WHERE member_id <> '';

COMMIT;

-- Vérification après exécution :
--   SELECT COUNT(*) FROM team_permissions;
--   SELECT COUNT(*) FROM team_members;
--   \d team_activation_codes
