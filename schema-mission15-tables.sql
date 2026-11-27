-- ============================================================================================
-- MISSION 15 — CAPACITÉ DES TABLES
--
-- Le cahier des charges demande de « définir la capacité » d'une table. La colonne est ADDITIVE
-- et nullable : les tables existantes restent valides, aucune donnée n'est touchée ni recalculée.
-- ============================================================================================

ALTER TABLE merchant_service_points ADD COLUMN IF NOT EXISTS capacity INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_service_points_capacity_check'
                 AND conrelid = 'merchant_service_points'::regclass) THEN
    ALTER TABLE merchant_service_points
      ADD CONSTRAINT merchant_service_points_capacity_check
      CHECK (capacity IS NULL OR (capacity >= 1 AND capacity <= 999));
  END IF;
END $$;
