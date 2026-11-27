-- ============================================================================================
-- MISSION 15 — OCCUPATION DES TABLES : historique et libération (§2.2 à §2.4 du prompt)
--
-- Une table « occupée » est une table qui porte au moins une commande non terminée. Pour savoir
-- QUI occupe la table, DEPUIS QUAND, et pour pouvoir la libérer sans rien effacer, il faut une
-- trace d'occupation distincte des commandes.
--
-- Ce script est ADDITIF : il ne modifie ni ne supprime aucune donnée existante.
--   · table_occupations : une ligne par occupation (début, fin, client, commandes, auteur de la
--     libération, motif). Une nouvelle occupation n'écrase jamais la précédente.
--   · merchant_orders.payment_confirmed_at / payment_confirmed_by : trace de la confirmation de
--     paiement, distincte du statut de la commande (une commande validée n'est pas forcément payée).
--   · merchant_service_points.occupation_status : état explicite ('free' | 'occupied'), piloté par
--     le personnel autorisé, et non plus déduit uniquement des commandes en cours.
-- ============================================================================================

CREATE TABLE IF NOT EXISTS table_occupations (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL,
  service_point_id  TEXT NOT NULL,
  point_name        TEXT NOT NULL DEFAULT '',
  table_number      TEXT NOT NULL DEFAULT '',
  zone              TEXT NOT NULL DEFAULT '',
  customer_name     TEXT NOT NULL DEFAULT '',
  occupied_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at       TIMESTAMPTZ,
  released_by_type  TEXT NOT NULL DEFAULT '',   -- merchant | staff | manager | system
  released_by_id    TEXT NOT NULL DEFAULT '',
  released_by_label TEXT NOT NULL DEFAULT '',
  release_reason    TEXT NOT NULL DEFAULT '',
  order_ids         JSONB NOT NULL DEFAULT '[]'::jsonb,
  orders_total_xof  BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS table_occupations_open_idx
  ON table_occupations (service_point_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS table_occupations_history_idx
  ON table_occupations (store_id, service_point_id, occupied_at DESC);

ALTER TABLE merchant_service_points
  ADD COLUMN IF NOT EXISTS occupation_status TEXT NOT NULL DEFAULT 'free';
ALTER TABLE merchant_service_points
  ADD COLUMN IF NOT EXISTS occupied_since TIMESTAMPTZ;

ALTER TABLE merchant_orders
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ;
ALTER TABLE merchant_orders
  ADD COLUMN IF NOT EXISTS payment_confirmed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_orders
  ADD COLUMN IF NOT EXISTS payment_confirmed_role TEXT NOT NULL DEFAULT '';

-- Une commande déjà marquée payée par un ancien mécanisme garde sa valeur : on ne réécrit rien.
CREATE INDEX IF NOT EXISTS merchant_orders_payment_idx
  ON merchant_orders (store_id, payment_status, created_at DESC);
