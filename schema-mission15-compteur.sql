-- ============================================================================================
-- MISSION 15 — COMPTEUR DE NOUVELLES COMMANDES
--
-- Une commande est « nouvelle » pour un établissement tant que PERSONNE du personnel ne l'a
-- ouverte. On enregistre donc, par commande et par membre de l'équipe, la date de première
-- consultation. Le compteur est la somme des commandes non annulées qui n'ont encore été vues
-- par personne : il ne peut donc pas contenir de doublon (contrainte d'unicité) et une commande
-- annulée n'y reste jamais.
--
-- Table purement additive : aucune commande, aucun compte, aucune donnée existante n'est modifiée.
-- ============================================================================================

CREATE TABLE IF NOT EXISTS merchant_order_views (
  order_id    TEXT NOT NULL REFERENCES merchant_orders(id) ON DELETE CASCADE,
  viewer_kind TEXT NOT NULL CHECK (viewer_kind IN ('merchant', 'staff', 'manager')),
  viewer_id   TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (order_id, viewer_kind, viewer_id)
);

CREATE INDEX IF NOT EXISTS merchant_order_views_order_idx ON merchant_order_views (order_id);
CREATE INDEX IF NOT EXISTS merchant_order_views_viewer_idx ON merchant_order_views (viewer_kind, viewer_id, seen_at DESC);

-- Une arrivée de commande est déjà tracée par merchant_orders.created_at ; cet index accélère le
-- comptage « non vues » qui est appelé à chaque ouverture de l'accueil.
CREATE INDEX IF NOT EXISTS merchant_orders_unseen_idx
  ON merchant_orders (store_id, created_at DESC)
  WHERE status NOT IN ('cancelled', 'rejected');
