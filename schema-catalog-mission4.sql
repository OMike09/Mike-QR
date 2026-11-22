-- ============================================================================================
-- Mission 4 — catalogue général, domaines d'activité, catégories et unités.
--
-- Migration STRICTEMENT ADDITIVE :
--   * aucune table existante n'est supprimée, renommée ou vidée ;
--   * aucun QR, magasin, produit, commande ou compteur existant n'est modifié ;
--   * les colonnes ajoutées sont nullables ou pourvues d'une valeur par défaut ;
--   * tout est rejouable (IF NOT EXISTS / ON CONFLICT / DO $$).
--
-- Ordre d'exécution : après le bloc « Mission 3 » de schema.sql, avant le démarrage du serveur.
-- Sauvegarde recommandée avant exécution : pg_dump.
-- ============================================================================================

BEGIN;

-- 1. Domaines d'activité administrables ------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_domains (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  family TEXT NOT NULL DEFAULT 'Autres',
  sector TEXT NOT NULL DEFAULT 'general',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS activity_domains_active_idx ON activity_domains (is_active, sort_order);

-- 2. Catégories modèles ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalog_category_domains (
  category_id TEXT NOT NULL REFERENCES catalog_categories(id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL REFERENCES activity_domains(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, domain_id)
);
CREATE INDEX IF NOT EXISTS catalog_category_domains_domain_idx ON catalog_category_domains (domain_id, category_id);

-- 3. Produits modèles ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY,
  catalog_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  variant TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'autre' CHECK (kind IN ('boisson','autre','service')),
  unit TEXT NOT NULL DEFAULT 'piece',
  packaging TEXT NOT NULL DEFAULT '',
  volume_code TEXT NOT NULL DEFAULT '',
  volume_label TEXT NOT NULL DEFAULT '',
  volume_ml INTEGER,
  image_key TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES catalog_categories(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catalog_products_category_idx ON catalog_products (category_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS catalog_products_brand_idx ON catalog_products (LOWER(brand));

CREATE TABLE IF NOT EXISTS catalog_product_domains (
  product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL REFERENCES activity_domains(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, domain_id)
);
CREATE INDEX IF NOT EXISTS catalog_product_domains_domain_idx ON catalog_product_domains (domain_id, product_id);

-- 4. Bibliothèque d'images réutilisables -----------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_media (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catalog_media_category_idx ON catalog_media (category, is_active, sort_order);

-- 5. Catégories propres à chaque boutique ----------------------------------------------
CREATE TABLE IF NOT EXISTS merchant_categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchant_stores(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  catalog_category_id TEXT REFERENCES catalog_categories(id) ON DELETE SET NULL,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_categories_store_slug_idx ON merchant_categories (store_id, slug);
CREATE INDEX IF NOT EXISTS merchant_categories_store_idx ON merchant_categories (store_id, sort_order);

-- 6. Colonnes additives sur les produits marchands -------------------------------------
-- `catalog_product_id` distingue une copie personnalisée de son modèle d'origine.
-- Les trois autres colonnes portent la contenance et l'unité de vente sans toucher aux
-- colonnes existantes (price_xof, image_data, category restent la source de vérité).
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS catalog_product_id TEXT REFERENCES catalog_products(id) ON DELETE SET NULL;
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'piece';
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS volume_label TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS volume_ml INTEGER;
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS image_key TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_products ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'visible';
CREATE INDEX IF NOT EXISTS merchant_products_catalog_idx ON merchant_products (catalog_product_id) WHERE catalog_product_id IS NOT NULL;

-- 7. Domaines choisis par le marchand (plusieurs activités possibles, une principale) ----
CREATE TABLE IF NOT EXISTS merchant_domains (
  merchant_id TEXT NOT NULL REFERENCES merchant_accounts(id) ON DELETE CASCADE,
  domain_id TEXT NOT NULL REFERENCES activity_domains(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, domain_id)
);
-- Une seule activité principale par marchand, garantie par la base.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_domains_primary_idx ON merchant_domains (merchant_id) WHERE is_primary = TRUE;

-- 8. Traçabilité des affectations automatiques ------------------------------------------
CREATE TABLE IF NOT EXISTS catalog_assignment_events (
  id TEXT PRIMARY KEY,
  merchant_id TEXT REFERENCES merchant_accounts(id) ON DELETE SET NULL,
  store_id TEXT REFERENCES merchant_stores(id) ON DELETE SET NULL,
  domain_codes TEXT[] NOT NULL DEFAULT '{}',
  categories_created INTEGER NOT NULL DEFAULT 0,
  products_available INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'registration',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catalog_assignment_events_store_idx ON catalog_assignment_events (store_id, created_at DESC);

-- 9. Contrainte d'unicité souple sur les unités connues (documentaire, non bloquante) ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merchant_products_volume_ml_check') THEN
    ALTER TABLE merchant_products ADD CONSTRAINT merchant_products_volume_ml_check
      CHECK (volume_ml IS NULL OR (volume_ml > 0 AND volume_ml <= 200000));
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Colonnes d'inscription / compte (multi-activités). Placées AVANT le COMMIT de la migration :
-- un premier passage peut avoir échoué sans elles, la migration reste donc rejouable.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS activity_domains JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE merchant_registrations ADD COLUMN IF NOT EXISTS activity_domain_label TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS activity_domains JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS activity_domain_label TEXT NOT NULL DEFAULT '';

COMMIT;

-- Vérification conseillée après exécution :
--   SELECT COUNT(*) FROM activity_domains;          -- 40 attendus après amorçage applicatif
--   SELECT COUNT(*) FROM catalog_categories;        -- 35
--   SELECT COUNT(*) FROM catalog_products;          -- 90
--   SELECT COUNT(*) FROM merchant_products WHERE catalog_product_id IS NOT NULL;
