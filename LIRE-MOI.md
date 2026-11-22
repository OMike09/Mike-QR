# OYMIKE QR — Catalogue (Mission 4, Prompt 1/3)

## Installation en 4 étapes

```bash
# 1. dépendances
npm ci

# 2. migration — À FAIRE AVANT LE PREMIER DÉMARRAGE, obligatoire en PostgreSQL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema-catalog-mission4.sql

# 3. démarrage
npm start

# 4. contrôle
npm test
```

`schema.sql` est le schéma complet d'origine (idempotent, `IF NOT EXISTS` partout).
`schema-catalog-mission4.sql` est la migration additive de cette mission : elle ajoute des tables et
des colonnes, **ne supprime rien**. Elle est rejouable sans risque.

Sans `DATABASE_URL`, l'application démarre en stockage JSON local (développement).

## Log attendu au démarrage

```
Catalogue général amorcé : 40 domaines, 35 catégories, 90 produits modèles.
Bibliothèque d'images : 56 référence(s) vérifiée(s).
```

Ces lignes n'apparaissent qu'une fois : ensuite l'amorçage se voit désactivé (idempotent).

## Vérification en base

```sql
SELECT COUNT(*) FROM activity_domains;    -- 40
SELECT COUNT(*) FROM catalog_categories;  -- 35
SELECT COUNT(*) FROM catalog_products;    -- 90
SELECT COUNT(*) FROM catalog_media;       -- 56
```

## Nouveaux fichiers de cette mission

- `catalog-seed.js` — référentiel : 40 domaines, 35 catégories, 90 modèles, 15 unités, 13 contenances
- `catalog.js` — moteur catalogue (PostgreSQL ou JSON)
- `catalog-routes.js` — routes marchand et administration
- `schema-catalog-mission4.sql` — migration additive
- `public/admin-catalog.js` — écran « Catalogue général »
- `public/media/catalogue/` — 56 images webp + image neutre
- `test/catalog.test.js`, `test/catalog-postgres.test.js` — 22 tests

## Fichiers modifiés

`server.js` (montage des routes, amorçage), `merchant-lifecycle.js` et `merchant-commerce.js`
(stockage des domaines déclarés), `merchant-routes.js` (unité, contenance, images du catalogue),
`public/merchant-signup.{html,js}` (liste déroulante groupée, multi-activités),
`public/merchant.{html,js}` (onglet Catalogue), `public/index.html` + `public/admin.js` (menu et libellés).

## Points à connaître

- Les fiches marchands **existantes** ne reçoivent pas de domaine rétroactivement.
- La migration doit être jouée **avant** le redémarrage : dans l'autre sens l'amorçage échoue
  (le message est dans les logs, l'application continue de tourner).
- L'image Olgane contient encore l'étiquette « OLOGANE » (défaut connu).
- « PDG » devient « Administrateur général » dans les interfaces ; les journaux d'audit déjà
  écrits gardent l'ancien libellé.
