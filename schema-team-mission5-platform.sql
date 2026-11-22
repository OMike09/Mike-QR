-- ============================================================================================
-- MISSION 5 — Paramétrage plateforme de l'équipe marchande
-- À exécuter APRÈS schema-team-mission5.sql. Additif et rejouable.
--
-- Le nombre de membres autorisés est fixé par l'Administrateur général (paramètres plateforme)
-- puis plafonné localement par le marchand : la limite effective est TOUJOURS le minimum des deux.
-- ============================================================================================
BEGIN;

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('teamLimits', '{"maxGeneralManagersPerMerchant":10,"maxWaitressesPerMerchant":50,"activationCodeTtlHours":72,"teamModuleEnabled":true}'::jsonb, NOW())
ON CONFLICT (setting_key) DO NOTHING;

-- Extensions de contraintes : une commande peut être saisie par une serveuse ou un gérant.
-- Les valeurs historiques restent valides (aucune ligne existante n'est touchée).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_source_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders DROP CONSTRAINT merchant_orders_source_check;
  END IF;
  ALTER TABLE merchant_orders DROP CONSTRAINT IF EXISTS merchant_orders_source_check;
  ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_source_check
    CHECK (source IN ('customer_qr','merchant_assisted','staff_assisted','manager_assisted'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='merchant_orders_created_by_type_check' AND conrelid='merchant_orders'::regclass) THEN
    ALTER TABLE merchant_orders DROP CONSTRAINT merchant_orders_created_by_type_check;
  END IF;
  ALTER TABLE merchant_orders ADD CONSTRAINT merchant_orders_created_by_type_check
    CHECK (created_by_type IN ('customer','merchant','manager','admin','general_manager','waitress'));
END;
$$;

COMMIT;

-- Vérification :
--   SELECT setting_value FROM app_settings WHERE setting_key='teamLimits';
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='merchant_orders_created_by_type_check';
