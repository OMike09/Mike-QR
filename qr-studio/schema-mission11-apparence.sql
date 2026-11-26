-- Mission 11 · sous-prompt 1 — thème d'interface choisi par le marchand.
-- Migration additive et sans risque : aucune donnée existante n'est modifiée
-- (les boutiques sans choix restent à '' et reçoivent le thème par défaut du PDG).
ALTER TABLE merchant_stores ADD COLUMN IF NOT EXISTS interface_theme TEXT NOT NULL DEFAULT '';
ALTER TABLE merchant_stores ALTER COLUMN interface_theme SET DEFAULT '';
DO $$ BEGIN
  ALTER TABLE merchant_stores ADD CONSTRAINT merchant_stores_interface_theme_check
    CHECK (interface_theme IN ('', 'green', 'black-gold', 'blue-white'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
