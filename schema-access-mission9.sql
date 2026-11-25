-- ============================================================================================
-- MISSION 9 — Validation des comptes du personnel, réinitialisation d'accès par code provisoire,
--             demandes de création de comptes et rattachement du marchand à son gestionnaire.
--
-- RÈGLE ABSOLUE : ce fichier est ADDITIF et REJOUABLE. Aucun DROP, aucun DELETE, aucun UPDATE
-- de masse. Il est exécuté APRÈS les schémas des missions 4 à 8, à chaque démarrage.
-- ============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. Demandes de création de compte du personnel, validées par le marchand.
--    Les demandes vivent dans leur propre table : la table team_members garde exactement sa
--    contrainte de statut actuelle (aucune valeur ajoutée, aucun risque sur les comptes en place).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_join_requests (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('general_manager','waitress')),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  designation TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  permissions JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT NOT NULL DEFAULT '',
  member_id TEXT,
  decided_by_type TEXT NOT NULL DEFAULT '',
  decided_by_id TEXT NOT NULL DEFAULT '',
  decided_by_label TEXT NOT NULL DEFAULT '',
  decided_at TIMESTAMPTZ,
  created_by_type TEXT NOT NULL DEFAULT 'merchant',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_join_requests_merchant_idx ON team_join_requests (merchant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS team_join_requests_member_idx ON team_join_requests (member_id) WHERE member_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 2. Codes provisoires de réinitialisation d'accès (format INITIALES-XXXXXX).
--    Le code en clair n'est JAMAIS stocké : seul le HMAC-SHA256 est enregistré, avec un indice
--    de 4 caractères pour l'affichage. Usage unique, échéance configurable, révocable.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_reset_codes (
  id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL CHECK (account_type IN ('merchant','manager','staff')),
  account_id TEXT NOT NULL,
  account_label TEXT NOT NULL DEFAULT '',
  code_prefix TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL,
  code_hint TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  requested_by_type TEXT NOT NULL DEFAULT 'admin',
  requested_by_id TEXT NOT NULL DEFAULT '',
  requested_by_label TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Unicité réelle du code : deux codes identiques ne peuvent pas coexister, quel que soit le
-- nombre d'établissements partageant les mêmes initiales.
CREATE UNIQUE INDEX IF NOT EXISTS access_reset_codes_hash_unique_idx ON access_reset_codes (code_hash);
CREATE INDEX IF NOT EXISTS access_reset_codes_account_idx ON access_reset_codes (account_type, account_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 3. Paramètres ajoutés au contrôle PDG (contacts réels affichés par « Mot de passe oublié ? »).
--    Stockés dans app_settings sous la clé « supportContact ». Aucun numéro n'est inventé :
--    si la valeur est vide, l'interface n'affiche aucun numéro.
-- ---------------------------------------------------------------------------------------------
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('supportContact', '{"phone":"","email":""}'::JSONB)
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 4. Réservation anti double usage des codes d'inscription terrain (Mission 8).
--    Une réservation de 15 minutes empêche deux personnes d'utiliser le même code en même temps.
--    Elle NE consomme PAS le code : la consommation reste la soumission réussie du dossier.
--    Colonnes nullables : les codes existants (uses déjà enregistrés) restent strictement valides.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE field_enrollment_codes ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;
ALTER TABLE field_enrollment_codes ADD COLUMN IF NOT EXISTS reserved_token TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS field_enrollment_codes_reserved_idx ON field_enrollment_codes (reserved_until)
  WHERE reserved_until IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 4. Correctif Mission 9 : les codes provisoires couvrent aussi les comptes du personnel.
--    Un marchand peut réinitialiser l'accès d'un gérant général ou d'une serveuse ; le code suit
--    exactement le même format (INITIALES-XXXXXX) et la même règle d'usage unique.
--    Rejouable : la contrainte est remplacée, jamais la table.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'access_reset_codes') THEN
    ALTER TABLE access_reset_codes DROP CONSTRAINT IF EXISTS access_reset_codes_account_type_check;
    ALTER TABLE access_reset_codes ADD CONSTRAINT access_reset_codes_account_type_check
      CHECK (account_type IN ('merchant','manager','staff'));
  END IF;
END $$;
