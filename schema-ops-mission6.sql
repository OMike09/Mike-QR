-- ============================================================================================
-- MISSION 6 — Prompt 3/3 : suivi opérationnel, points, messagerie, affectations
-- Migration ADDITIVE et REJOUABLE. Aucune table existante n'est supprimée ni réécrite.
--
--   staff_point_events      journal immuable des points (gain, retrait, correction) avec motif + auteur
--   staff_point_settings    barème configurable par le marchand (valeurs par action)
--   team_conversations      fils de discussion : support gestionnaire ou interne équipe
--   team_messages           messages d'un fil, avec pièce jointe facultative
--   team_message_reads      état « lu » par participant (pas par appareil)
--   team_notifications      notifications internes persistantes, destinataire par destinataire
--   team_service_point_assignments  affectation durable d'une table/emplacement à une serveuse
--   team_order_assignments  affectation d'une commande à une serveuse, avec historique de transfert
-- ============================================================================================
BEGIN;

-- 1. Barème des points ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_point_settings (
  merchant_id TEXT PRIMARY KEY REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  points_scan INTEGER NOT NULL DEFAULT 1 CHECK (points_scan BETWEEN 0 AND 100),
  points_order INTEGER NOT NULL DEFAULT 2 CHECK (points_order BETWEEN 0 AND 100),
  points_order_completed INTEGER NOT NULL DEFAULT 2 CHECK (points_order_completed BETWEEN 0 AND 100),
  points_task INTEGER NOT NULL DEFAULT 2 CHECK (points_task BETWEEN 0 AND 100),
  -- Règle explicite demandée : sans elle, une commande n'attribue jamais de points à une autre
  -- serveuse que celle qui l'a enregistrée.
  credit_assigned_server BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Journal des points : append-only, jamais réécrit --------------------------------
CREATE TABLE IF NOT EXISTS staff_point_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  member_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('scan','order','order_completed','task','manual_add','manual_remove','correction')),
  points INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  -- Clé d'unicité de l'événement source : « scan:<id> », « order:<id> », « task:<id> ».
  -- Empêche tout double comptage (double scan, double validation, double clic).
  source_key TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system','merchant','general_manager','waitress','admin')),
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_point_events_unique_source_idx ON staff_point_events (merchant_id, source_key, action);
CREATE INDEX IF NOT EXISTS staff_point_events_member_idx ON staff_point_events (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_point_events_merchant_date_idx ON staff_point_events (merchant_id, created_at DESC);

-- 3. Messagerie : support gestionnaire et consignes internes ------------------------
CREATE TABLE IF NOT EXISTS team_conversations (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES merchant_stores(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('support','internal')),
  -- Pour une conversation de support vers un gestionnaire de plateforme (table `managers`).
  manager_id TEXT REFERENCES managers(id) ON DELETE SET NULL,
  -- Pour une conversation de support vers le gérant général de l'équipe (table `team_members`).
  staff_manager_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  -- Pour une conversation interne : le membre destinataire (consigne individuelle).
  member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received','read','answered','closed')),
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('merchant','manager','general_manager','waitress','admin')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_label TEXT NOT NULL DEFAULT '',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by_type TEXT NOT NULL DEFAULT '',
  closed_by_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_conversations_merchant_idx ON team_conversations (merchant_id, kind, last_message_at DESC);
-- Colonne ajoutée aux installations existantes (migration rejouable, jamais destructive).
ALTER TABLE team_conversations ADD COLUMN IF NOT EXISTS staff_manager_id TEXT REFERENCES team_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS team_conversations_staff_manager_idx ON team_conversations (staff_manager_id, kind, last_message_at DESC);
CREATE INDEX IF NOT EXISTS team_conversations_manager_idx ON team_conversations (manager_id, kind, last_message_at DESC);

CREATE TABLE IF NOT EXISTS team_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES team_conversations(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('merchant','manager','general_manager','waitress','admin','system')),
  author_id TEXT NOT NULL DEFAULT '',
  author_label TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  attachment_data TEXT NOT NULL DEFAULT '',
  attachment_name TEXT NOT NULL DEFAULT '',
  attachment_mime TEXT NOT NULL DEFAULT '',
  attachment_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_messages_conversation_idx ON team_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS team_message_reads (
  conversation_id TEXT NOT NULL REFERENCES team_conversations(id) ON DELETE CASCADE,
  reader_type TEXT NOT NULL CHECK (reader_type IN ('merchant','manager','general_manager','waitress','admin')),
  reader_id TEXT NOT NULL DEFAULT '',
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, reader_type, reader_id)
);

-- 4. Notifications internes persistantes --------------------------------------------
CREATE TABLE IF NOT EXISTS team_notifications (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT REFERENCES merchant_stores(id) ON DELETE SET NULL,
  member_id TEXT REFERENCES team_members(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Même clé = même événement : un compteur ne double jamais.
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS team_notifications_dedupe_idx ON team_notifications (merchant_id, member_id, dedupe_key);
CREATE INDEX IF NOT EXISTS team_notifications_member_idx ON team_notifications (member_id, read_at, created_at DESC);

-- 4 bis. Scans du personnel : la contrainte historique n'autorisait que client / marchand /
-- inconnu ; le personnel marchand (serveuse, gérant général) doit être identifiable.
ALTER TABLE merchant_scan_events DROP CONSTRAINT IF EXISTS merchant_scan_events_category_check;
ALTER TABLE merchant_scan_events ADD CONSTRAINT merchant_scan_events_category_check
  CHECK (category IN ('customer','merchant','staff','unknown'));
ALTER TABLE merchant_scan_events DROP CONSTRAINT IF EXISTS merchant_scan_events_actor_type_check;
ALTER TABLE merchant_scan_events ADD CONSTRAINT merchant_scan_events_actor_type_check
  CHECK (actor_type IN ('customer','merchant','staff','unknown'));

-- 5. Affectation des tables et des commandes ----------------------------------------
CREATE TABLE IF NOT EXISTS team_service_point_assignments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  service_point_id TEXT NOT NULL REFERENCES merchant_service_points(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  assigned_by_type TEXT NOT NULL DEFAULT 'merchant',
  assigned_by_id TEXT NOT NULL DEFAULT '',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_point_id)
);
CREATE INDEX IF NOT EXISTS team_service_point_assignments_member_idx ON team_service_point_assignments (member_id);

CREATE TABLE IF NOT EXISTS team_order_assignments (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES merchant_orders(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  member_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('assigned','transferred','unassigned')),
  from_member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  from_member_label TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'merchant',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_order_assignments_order_idx ON team_order_assignments (order_id, created_at);
CREATE INDEX IF NOT EXISTS team_order_assignments_member_idx ON team_order_assignments (member_id, created_at DESC);

-- 6. Affectation courante de la commande (dénormalisée pour les listes) --------------
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS assigned_member_id TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_orders ADD COLUMN IF NOT EXISTS assigned_designation TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_orders_assigned_idx ON merchant_orders (assigned_member_id, created_at DESC) WHERE assigned_member_id <> '';

COMMIT;

-- Vérification :
--   SELECT COUNT(*) FROM staff_point_settings;
--   \d staff_point_events
--   \d team_conversations
