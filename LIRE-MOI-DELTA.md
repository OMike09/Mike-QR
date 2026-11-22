# DELTA — Mission 4, Prompt 1/3 : catalogue automatique

Ce colis contient **uniquement les fichiers qui changent**. Aucune structure complète, aucune
réinstallation. Les fichiers non listés ici restent exactement ceux déjà en production.

## Installation

1. **Sauvegarder** le dossier `public/` de production (copie du répertoire, pas besoin de le renommer).
2. Copier les fichiers de ce colis par-dessus, **en respectant les chemins** (même arborescence).
3. **Exécuter la migration avant de redémarrer** :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema-catalog-mission4.sql
```

4. Redémarrer le service.

Ne pas exécuter `schema.sql` : il n'est pas livré ici, le schéma d'origine est déjà en place.

## Vérification

```sql
SELECT COUNT(*) FROM activity_domains;    -- 40
SELECT COUNT(*) FROM catalog_categories;  -- 35
SELECT COUNT(*) FROM catalog_products;    -- 90
SELECT COUNT(*) FROM catalog_media;       -- 56
```

Log de démarrage attendu, une seule fois :

```
Catalogue général amorcé : 40 domaines, 35 catégories, 90 produits modèles.
Bibliothèque d'images : 56 référence(s) vérifiée(s).
```

Contrôle rapide dans le navigateur :

- `https://qr-rakesh.oymiketech.com/api/public/activity-domains` doit renvoyer une liste de 40 entrées
  (aujourd'hui : 404 → le delta n'est pas encore en place).
- `/admin` → menu **Catalogue général** : compteurs 40 / 35 / 90 / 56 / 0 doublon.
- `/devenir-marchand` → « Commencer ma demande » → liste à 3 familles.

## Contenu (38 fichiers + 57 images)

**Nouveaux fichiers — à créer**

| Fichier | Rôle |
|---|---|
| `catalog-seed.js` | référentiel : 40 domaines, 35 catégories, 90 modèles, 15 unités, 13 contenances |
| `catalog.js` | moteur catalogue (PostgreSQL ou JSON) |
| `catalog-routes.js` | routes marchand + administration |
| `schema-catalog-mission4.sql` | migration additive, rejouable, ne supprime rien |
| `public/admin-catalog.js` | écran « Catalogue général » |
| `public/media/*.webp` (56) + `placeholder.svg` | bibliothèque d'images, une image par référence |

**Fichiers remplacés — le détail de ce qui change**

| Fichier | Modification |
|---|---|
| `server.js` | instancie le catalogue, monte ses routes, amorçage et import des images au démarrage |
| `merchant-lifecycle.js` | stocke les domaines déclarés à l'inscription, affecte les catégories à l'approbation |
| `merchant-commerce.js` | colonnes `activity_domains` et `activity_domain_label` ; `unit`, `volume_label`, `volume_ml`, `image_key`, `visibility` sur les produits |
| `merchant-routes.js` | valide l'unité et la contenance (cl/ml/L), accepte les images de `/media/catalogue/` |
| `merchant-lifecycle-routes.js` | expose les domaines secondaires dans les dossiers |
| `manager-routes.js` | libellés « Administrateur général » |
| `merchant-extras.js` | idem |
| `public/index.html` | menu latéral « Catalogue général » + écran complet, libellés |
| `public/admin.js` | route vers l'écran catalogue, titre, libellés |
| `public/admin.css` | styles de l'écran catalogue |
| `public/merchant-signup.html` | champ texte remplacé par la liste groupée + activités secondaires + précision « Autre » |
| `public/merchant-signup.js` | chargement de la liste publique, multi-activités, secteur déduit |
| `public/merchant.html` | onglet « Catalogue » + unité, contenance, visibilité dans le formulaire produit |
| `public/merchant.js` | écran catalogue, ajout avec prix marchand, activités modifiables |
| `public/merchant-dashboard.css` | styles catalogue marchand |
| `public/manager.html`, `public/manager.js`, `public/manager-merchants.js` | libellés |
| `public/merchant-control.{html,js}`, `public/merchant-registrations.{css,js}`, `public/merchant-reset-password.html`, `public/merchant-scanner.js`, `public/merchant-assisted-orders.css` | libellés |
| `public/order-recovery.html`, `public/supplier.{html,js}`, `public/qr-wizard.js`, `public/qr-templates.js`, `public/qr-admin-studio.js` | libellés |

**Tests (facultatifs en production)**

`test/catalog.test.js` (13 tests, sans base) et `test/catalog-postgres.test.js` (9 tests, exige
`DATABASE_URL_TEST`). Ils ne s'exécutent que si on les lance.

## Retour arrière

Copier le dossier `public/` sauvegardé à l'étape 1, restaurer les 9 fichiers JS de la racine depuis
la sauvegarde du dépôt, redémarrer. La migration n'a rien supprimé : les tables ajoutées peuvent
rester en place sans gêner l'ancienne version.

## Limites connues

- Les fiches marchands existantes ne reçoivent pas de domaine rétroactivement.
- L'image Olgane contient encore l'étiquette « OLOGANE ».
- Les journaux d'audit déjà écrits gardent le libellé « PDG » (données historiques inchangées).
