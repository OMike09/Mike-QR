-- ============================================================================================
-- MISSION 12 — Gestion des tables et des espaces : numéro choisi par le marchand.
--
-- ADDITIF ET REJOUABLE. Aucune table n'est renommée ni supprimée : `merchant_service_points`
-- reste LA source des tables et des QR imprimés (/t/<public_code>). On ajoute seulement :
--   · `table_number` : le numéro affiché et choisi par le marchand (« 12 », « A3 », « Terrasse 2 ») ;
--   · un index unique PAR ÉTABLISSEMENT : deux boutiques différentes peuvent utiliser « 1 »,
--     mais une même boutique ne peut pas avoir deux fois le même numéro actif.
-- Les tables déjà créées ne sont pas modifiées : leur numéro est repris de leur nom s'il en
-- contient un (« Table 12 » → « 12 »), sinon il reste vide et le marchand le renseigne.
-- ============================================================================================
BEGIN;

ALTER TABLE merchant_service_points ADD COLUMN IF NOT EXISTS table_number TEXT NOT NULL DEFAULT '';

-- Reprise douce du numéro depuis le nom, uniquement quand il n'y a aucun doublon possible.
UPDATE merchant_service_points
   SET table_number = btrim(regexp_replace(name, '^\s*(table|n[o°])\s*', '', 'i'))
 WHERE point_type = 'table'
   AND btrim(table_number) = ''
   AND name ~* '^\s*(table\s*)?[0-9]'
   AND btrim(regexp_replace(name, '^\s*(table|n[o°])\s*', '', 'i')) <> '';

-- Unicité par établissement sur les emplacements ACTIFS seulement : une table désactivée garde
-- son numéro mais ne bloque pas la réutilisation du numéro par une nouvelle table.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_service_points_store_number_idx
  ON merchant_service_points (store_id, lower(btrim(table_number)))
  WHERE status = 'active' AND btrim(table_number) <> '';

CREATE INDEX IF NOT EXISTS merchant_service_points_store_zone_idx
  ON merchant_service_points (store_id, zone);

COMMIT;
