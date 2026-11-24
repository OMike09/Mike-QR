-- ============================================================================================
-- MISSION 8 — CONTRÔLE TOTAL DU PDG
-- Inscriptions marchands (photos, informations complémentaires), codes d'inscription terrain à
-- usage unique, notifications PDG, journal d'audit dédié, quotas d'équipe avancés, code de
-- sécurité protégeant les points des gestionnaires.
--
-- RÈGLES DE CE FICHIER :
--   • Strictement ADDITIF : aucune table existante n'est supprimée ni réécrite.
--   • Rejouable indéfiniment (IF NOT EXISTS / DROP CONSTRAINT puis ADD).
--   • Les CHECK existants sont ÉLARGIS, jamais réduits : les valeurs déjà en base restent valides.
-- ============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. Inscriptions marchands : statut « informations complémentaires demandées » + photos
-- ---------------------------------------------------------------------------------------------
-- Élargissement du statut : les 5 valeurs d'origine restent acceptées, on ajoute `needs_info`
-- (informations complémentaires demandées) et `archived` (dossier classé sans suppression).
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'merchant_registrations' AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%status%'
   LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE merchant_registrations DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
ALTER TABLE merchant_registrations
  ADD CONSTRAINT merchant_registrations_status_check
  CHECK (status IN ('pending','in_review','approved','rejected','suspended','needs_info','archived'));

-- Photos de l'établissement : plusieurs images, prises à la caméra ou choisies dans la galerie.
-- Stockées en base comme les images existantes (data-URI compressée côté navigateur) afin de
-- rester accessibles après reconnexion, sans dépendre d'un volume partagé.
CREATE TABLE IF NOT EXISTS merchant_registration_photos (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES merchant_registrations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 20),
  label TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg' CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  data_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS merchant_registration_photos_owner_idx
  ON merchant_registration_photos (registration_id, position);

-- Demande d'informations complémentaires : la liste précise de ce qui manque, côté demandeur.
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS info_requested TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS info_requested_at TIMESTAMPTZ;
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS info_requested_by TEXT NOT NULL DEFAULT '';
-- Code terrain consommé par cette inscription (traçabilité, jamais le code en clair).
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS field_code_id TEXT;
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS field_manager_id TEXT;
-- Quota d'équipe appliqué au moment de la création du compte par un gestionnaire terrain.
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS team_quota_source TEXT NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------------------------
-- 2. Codes d'inscription terrain (usage unique strict)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_enrollment_codes (
  id TEXT PRIMARY KEY,
  -- Le code en clair n'est JAMAIS stocké : seul le hachage HMAC est conservé.
  code_hash TEXT NOT NULL UNIQUE,
  -- Fin du code pour que son créateur puisse le reconnaître sans le révéler entièrement.
  code_hint TEXT NOT NULL DEFAULT '',
  created_by_type TEXT NOT NULL CHECK (created_by_type IN ('admin','manager')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_label TEXT NOT NULL DEFAULT '',
  -- Le code d'un gestionnaire n'ouvre que ses propres inscriptions ; celui du PDG est central.
  manager_id TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 100),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT NOT NULL DEFAULT '',
  revoked_reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- Quotas d'équipe imposés au marchand créé via ce code (NULL = quotas plateforme).
  team_max_general_managers INTEGER CHECK (team_max_general_managers IS NULL OR team_max_general_managers BETWEEN 0 AND 200),
  team_max_waitresses INTEGER CHECK (team_max_waitresses IS NULL OR team_max_waitresses BETWEEN 0 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Contrainte posée séparément : PostgreSQL refuse une contrainte nommée dans un CREATE TABLE
-- IF NOT EXISTS rejoué sur une base où la table existe déjà.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
     WHERE rel.relname = 'field_enrollment_codes' AND con.conname = 'field_enrollment_codes_uses_check'
  ) THEN
    ALTER TABLE field_enrollment_codes ADD CONSTRAINT field_enrollment_codes_uses_check CHECK (uses <= max_uses);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS field_enrollment_codes_manager_idx
  ON field_enrollment_codes (manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS field_enrollment_codes_status_idx
  ON field_enrollment_codes (expires_at, revoked_at, uses);

-- Journal d'utilisation : une ligne par consommation, avec l'inscription obtenue.
-- C'est ce qui rend l'historique « inscriptions terrain par gestionnaire » fiable même si
-- l'inscription est ensuite refusée.
CREATE TABLE IF NOT EXISTS field_code_uses (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL REFERENCES field_enrollment_codes(id) ON DELETE RESTRICT,
  registration_id TEXT REFERENCES merchant_registrations(id) ON DELETE SET NULL,
  manager_id TEXT,
  manager_label TEXT NOT NULL DEFAULT '',
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS field_code_uses_code_idx ON field_code_uses (code_id, used_at DESC);
CREATE INDEX IF NOT EXISTS field_code_uses_manager_idx ON field_code_uses (manager_id, used_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 3. Centre de notifications du PDG (et des gestionnaires pour leurs propres codes)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY,
  -- Destinataire : 'admin' pour le PDG, 'manager:<id>' pour un gestionnaire précis.
  recipient_type TEXT NOT NULL DEFAULT 'admin' CHECK (recipient_type IN ('admin','manager')),
  recipient_id TEXT NOT NULL DEFAULT '',
  notification_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','danger')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- Lien direct vers le dossier concerné : le PDG clique et ouvre la fiche.
  link_view TEXT NOT NULL DEFAULT '',
  link_id TEXT NOT NULL DEFAULT '',
  -- Anti-doublon : deux alertes identiques ne sont jamais empilées.
  dedupe_key TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_dedupe_idx
  ON admin_notifications (recipient_type, recipient_id, dedupe_key) WHERE dedupe_key <> '';
CREATE INDEX IF NOT EXISTS admin_notifications_recipient_idx
  ON admin_notifications (recipient_type, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
  ON admin_notifications (recipient_type, recipient_id, created_at DESC) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 4. Journal d'audit dédié Mission 8, en lecture seule pour tout le monde sauf l'insertion.
--    (audit_logs existant est conservé tel quel ; ce journal sert aux opérations sensibles.)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_journal (
  id BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin','manager','merchant','team_member','system')),
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  merchant_id TEXT,
  manager_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  before_data JSONB,
  after_data JSONB,
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_audit_journal_created_idx ON admin_audit_journal (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_journal_actor_idx ON admin_audit_journal (manager_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_journal_entity_idx ON admin_audit_journal (entity_type, entity_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 5. Quotas d'équipe avancés
-- ---------------------------------------------------------------------------------------------
-- Quota particulier d'un marchand, décidé par le PDG. Priorité : ligne présente & active >
-- quota hérité du code terrain > quota plateforme.
CREATE TABLE IF NOT EXISTS merchant_team_quota_overrides (
  merchant_id TEXT PRIMARY KEY REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  max_general_managers INTEGER NOT NULL DEFAULT 1 CHECK (max_general_managers BETWEEN 0 AND 200),
  max_waitresses INTEGER NOT NULL DEFAULT 2 CHECK (max_waitresses BETWEEN 0 AND 500),
  -- Dépassement exceptionnel : places supplémentaires accordées temporairement.
  extra_general_managers INTEGER NOT NULL DEFAULT 0 CHECK (extra_general_managers BETWEEN 0 AND 200),
  extra_waitresses INTEGER NOT NULL DEFAULT 0 CHECK (extra_waitresses BETWEEN 0 AND 500),
  extra_expires_at TIMESTAMPTZ,
  -- Règle explicite : un compte bloqué/suspendu réserve-t-il encore une place ?
  suspended_reserves_slot BOOLEAN NOT NULL DEFAULT FALSE,
  -- Le marchand a-t-il le droit de modifier lui-même ses chiffres ? Toujours faux par défaut :
  -- seul le PDG fixe les quotas. Conservé pour un éventuel octroi explicite.
  merchant_can_edit_quotas BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------------------------
-- 6. Code de sécurité des points gestionnaires
-- ---------------------------------------------------------------------------------------------
ALTER TABLE managers ADD COLUMN IF NOT EXISTS points_code_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE managers ADD COLUMN IF NOT EXISTS points_code_set_at TIMESTAMPTZ;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS points_code_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS points_code_locked_until TIMESTAMPTZ;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS points_code_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Solde de points d'un gestionnaire de plateforme (le gestionnaire n'est pas un membre d'équipe :
-- team_members.points concerne le gérant/serveuse d'un marchand, pas le gestionnaire terrain).
CREATE TABLE IF NOT EXISTS manager_points (
  manager_id TEXT PRIMARY KEY REFERENCES managers(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chaque mouvement de points d'un gestionnaire est un événement immuable.
CREATE TABLE IF NOT EXISTS manager_point_events (
  id TEXT PRIMARY KEY,
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  points_before INTEGER NOT NULL,
  points_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','field_enrollment','bonus','correction','validation')),
  actor_type TEXT NOT NULL DEFAULT 'admin' CHECK (actor_type IN ('admin','manager','system')),
  actor_id TEXT NOT NULL DEFAULT '',
  actor_label TEXT NOT NULL DEFAULT '',
  -- Clé d'unicité de l'événement source : empêche tout double comptage.
  source_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manager_point_events_balance_check CHECK (points_before + delta = points_after)
);
CREATE INDEX IF NOT EXISTS manager_point_events_manager_idx
  ON manager_point_events (manager_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 7. Sécurité : journal en insertion seule
-- ---------------------------------------------------------------------------------------------
-- Aucune route n'expose de UPDATE/DELETE sur ces tables ; la protection est aussi posée ici pour
-- qu'un futur code ne puisse pas réécrire l'historique par mégarde.
CREATE OR REPLACE FUNCTION admin_audit_journal_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en lecture seule : une opération ne peut être ni modifiée ni supprimée.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_audit_journal_no_update ON admin_audit_journal;
CREATE TRIGGER admin_audit_journal_no_update
  BEFORE UPDATE OR DELETE ON admin_audit_journal
  FOR EACH ROW EXECUTE FUNCTION admin_audit_journal_immutable();

DROP TRIGGER IF EXISTS manager_point_events_no_update ON manager_point_events;
CREATE TRIGGER manager_point_events_no_update
  BEFORE UPDATE OR DELETE ON manager_point_events
  FOR EACH ROW EXECUTE FUNCTION admin_audit_journal_immutable();

-- ---------------------------------------------------------------------------------------------
-- 8. Permissions supplémentaires des gestionnaires (accordées par le PDG uniquement)
-- ---------------------------------------------------------------------------------------------
-- Un gestionnaire ne peut générer de codes terrain que si le PDG l'y a explicitement autorisé.
ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_create_field_codes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE managers ADD COLUMN IF NOT EXISTS can_view_field_history BOOLEAN NOT NULL DEFAULT TRUE;
-- Quota hérité du code terrain utilisé pour créer le compte marchand (NULL = quota plateforme).
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS team_quota_general_managers INTEGER;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS team_quota_waitresses INTEGER;
