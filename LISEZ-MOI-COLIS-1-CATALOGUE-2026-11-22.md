# Colis 1 — Catalogue automatique (Mission 4, Prompt 1/3)

Date : 22 novembre 2026. Contenu : le projet complet tel que testé, plus la migration et les tests.

## Installation

```bash
npm ci
# base PostgreSQL (recommandé) : appliquer le schéma existant puis la migration additive
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema-catalog-mission4.sql
npm start
```

Sans `DATABASE_URL`, l'application démarre avec le stockage JSON local (développement).
Au démarrage, le catalogue s'amorce tout seul : **40 domaines, 35 catégories, 90 produits modèles**,
et les **56 images** de `public/media/catalogue/` sont référencées (idempotent, rien n'est écrasé).

## Vérifier après démarrage

```sql
SELECT COUNT(*) FROM activity_domains;                 -- 40
SELECT COUNT(*) FROM catalog_categories;               -- 35
SELECT COUNT(*) FROM catalog_products;                 -- 90 (56 boissons + 34 autres)
SELECT COUNT(*) FROM catalog_media;                    -- 56
SELECT COUNT(*) FROM catalog_products p WHERE p.kind='boisson'
  AND NOT EXISTS (SELECT 1 FROM catalog_media m WHERE m.key=p.image_key);  -- 0
```

Interface : `/admin` → menu **Catalogue général**. Inscription marchand : `/devenir-marchand`.

## Tests

```bash
npm test                                                     # 105 tests, 1 ignoré (PostgreSQL)
DATABASE_URL_TEST=postgres://user@host:port/base npm test test/catalog-postgres.test.js
```

Le test PostgreSQL refuse de s'exécuter sans `DATABASE_URL_TEST` : il ne touche jamais la production.
Il vérifie en base réelle les contenances en millilitres, les unités, l'unicité des images,
le multi-activités et la conservation des personnalisations marchand.

## Fichiers nouveaux ou modifiés pour cette mission

| Fichier | Rôle |
|---|---|
| `catalog-seed.js` | référentiel : 40 domaines, 35 catégories, 90 modèles, 15 unités, 13 contenances |
| `catalog.js` | moteur catalogue, double backend PostgreSQL / JSON |
| `catalog-routes.js` | routes marchand et administration du catalogue |
| `schema-catalog-mission4.sql` | migration additive, rejouable (exécutée sur PostgreSQL 17) |
| `public/admin-catalog.js` | écran « Catalogue général » |
| `public/media/catalogue/` | 56 images webp + image neutre `placeholder.svg` |
| `public/merchant-signup.{html,js}` | liste déroulante groupée, multi-activités, « Autre » |
| `public/merchant.{html,js}` | onglet « Catalogue », activités, unité et contenance |
| `merchant-lifecycle.js`, `merchant-commerce.js`, `merchant-routes.js` | stockage des domaines, unité/contenance validées, images du catalogue autorisées |
| `test/catalog.test.js`, `test/catalog-postgres.test.js` | 22 tests dédiés |

## Points à savoir avant de déployer

- La migration est **additive** : aucune colonne ni donnée existante n'est supprimée.
- Les fiches marchands **existantes** ne reçoivent pas de domaine rétroactivement.
- L'image Olgane contient encore l'étiquette « OLOGANE » (défaut connu, non régénérée).
- « PDG » est remplacé par « Administrateur général » dans les interfaces ; les journaux d'audit
  déjà écrits gardent l'ancien libellé (données historiques intactes).
