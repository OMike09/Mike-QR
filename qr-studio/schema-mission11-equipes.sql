-- ============================================================================================
-- MISSION 11 · SOUS-PROMPT 2 — Équipes : affectations multiples + verrouillage des connexions.
--
-- Migration ADDITIVE : aucune table existante n'est modifiée en place, aucune donnée n'est
-- supprimée. Les comptes actuels continuent de fonctionner à l'identique.
-- ============================================================================================
BEGIN;

-- 1. Affectations multiples : une table / un salon peut être confié à plusieurs membres.
--    `team_member_service_points` porte TOUTES les affectations.
--    L'affectation « principale » (is_primary) reste celle qui reçoit automatiquement les
--    commandes de la table, via l'ancienne table team_service_point_assignments (inchangée).
CREATE TABLE IF NOT EXISTS team_member_service_points (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  service_point_id TEXT NOT NULL REFERENCES merchant_service_points(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_by_type TEXT NOT NULL DEFAULT 'merchant',
  assigned_by_id TEXT NOT NULL DEFAULT '',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, service_point_id)
);
CREATE INDEX IF NOT EXISTS team_member_service_points_member_idx ON team_member_service_points (merchant_id, member_id);
CREATE INDEX IF NOT EXISTS team_member_service_points_point_idx ON team_member_service_points (service_point_id);
-- Une seule affectation principale par table : la commande ne peut pas partir vers deux personnes.
CREATE UNIQUE INDEX IF NOT EXISTS team_member_service_points_primary_idx
  ON team_member_service_points (service_point_id) WHERE is_primary;

-- 2. Historique des affectations : qui était responsable de quelle table, et quand.
--    Rien n'est jamais effacé : un retrait est écrit comme une nouvelle ligne.
CREATE TABLE IF NOT EXISTS team_assignment_history (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  service_point_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_label TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL CHECK (action IN ('assigned', 'unassigned')),
  from_member_id TEXT NOT NULL DEFAULT '',
  from_member_label TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'merchant',
  actor_label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_assignment_history_point_idx ON team_assignment_history (merchant_id, service_point_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_assignment_history_member_idx ON team_assignment_history (merchant_id, member_id, created_at DESC);

-- 3. Reprise des affectations existantes (mission 6) : la responsable actuelle d'une table
--    devient son affectation principale et son affectation déclarée. Idempotent.
INSERT INTO team_member_service_points (id, merchant_id, store_id, member_id, service_point_id, is_primary, assigned_by_type, assigned_by_id, assigned_at)
SELECT 'tspm_' || substr(md5(a.id), 1, 20), a.merchant_id, a.store_id, a.member_id, a.service_point_id, TRUE,
       a.assigned_by_type, a.assigned_by_id, a.assigned_at
  FROM team_service_point_assignments a
 ON CONFLICT (member_id, service_point_id) DO NOTHING;

-- 4. Verrouillage progressif des connexions de l'équipe (mot de passe à 6 chiffres).
--    Le compteur est porté par le compte : 10^6 valeurs ne tiennent que si l'on compte par compte.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

COMMIT;
