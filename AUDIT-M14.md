# AUDIT TECHNIQUE — MISSION 14 (phase 1)
Date : 10 octobre 2026 · Périmètre : application `qr-studio` · Aucune modification de la production

## 1. Environnement de travail (à savoir avant de lire les chiffres)

| Élément | Constat |
|---|---|
| `node_modules` | **absent** du workspace (exclu des sauvegardes) → serveur impossible à démarrer. Réinstallé (`npm install`, 122 paquets). |
| PostgreSQL | **absent de la machine**. L'application démarrait donc en stockage JSON local, où plusieurs modules refusent volontairement de fonctionner (messagerie, consignation, tables, historiques, vue d'ensemble). |
| Correctif d'environnement | PostgreSQL 17 installé, base neuve `oymike_m14_test`, les **10 schémas** de `schema*.sql` appliqués : **0 erreur**. L'application tourne maintenant en mode PostgreSQL, comme en production. |
| Compte de recette | Créé par le vrai parcours public : `POST /api/public/merchant-registrations` → approbation PDG (`/api/admin/merchant-registrations/:id/decision`). Identifiant `baobab436789`, code `482913`, boutique « Maquis Le Baobab ». |
| Production | **Non touchée** : aucune variable d'environnement modifiée, aucune URL marchande créée. |

## 2. Bugs réels trouvés et corrigés (cause → conséquence)

### Bug n° 1 — Un cookie vidé était compté comme un rôle connecté (gravité : bloquante)
- Où : `history-routes.js` (`resolveActor`), `overview-routes.js` (`hasCookie`), `staff-routes.js` (`otherCookies`).
- Cause : le test était `/(^|;)\s*qria_admin=/`, qui matche aussi `qria_admin=` **sans valeur**, cookie que le serveur lui-même pose à la déconnexion.
- Conséquence mesurée : un marchand fraîchement connecté envoyait `qria_admin=; qria_manager=; qria_supplier=; qria_merchant=<jeton>`. Le serveur comptait **2 rôles** → « sessions de rôles différentes » → **401 sur `/api/history` et `/api/overview`** alors que `/api/merchant/team` et `/api/merchant/store` répondaient 200.
- Effet visible : « Voir les historiques » et la carte « Vue d'ensemble » vides **pour tout le monde**, sans message explicite.
- Correctif : la valeur du cookie est désormais obligatoire (`=([^;\s]+)`). Un cookie vidé n'est plus une identité.

### Bug n° 2 — Le garde marchand plantait silencieusement dans les faux `res`
- Où : `history-routes.js` et `overview-routes.js`, objet `res` factice passé aux gardes.
- Cause : le garde écrit une réponse de refus (`status().json()`, `res.append`, `res.locals`) ; le faux objet n'exposait ni `append`, ni `locals`, ni `send`. L'appel levait une `TypeError` avalée par le `catch`, interprétée comme « accès refusé ».
- Conséquence mesurée : **500 « Impossible de charger les historiques »** et journal `[history] Cannot read properties of undefined (reading 'query')`.
- Correctif : le faux `res` expose maintenant `status/json/send/end/setHeader/getHeader/append/set/cookie/clearCookie/locals`.

### Vérification après correctif (mêmes appels, session marchande réelle)

| Route | Avant | Après |
|---|---|---|
| `GET /api/overview` | 401 | **200** (4 cartes, périmètre de la boutique) |
| `GET /api/overview/orders?view=new` | 401 | **200** |
| `GET /api/history?period=month` | 500 | **200** (6 catégories) |
| `GET /api/merchant/table-management` | 400 | **200** (points, zones, résumé) |

## 3. Chasse aux 404 et aux boutons morts (méthode et résultats)

1. **Routes réellement montées** : instrumentation d'Express au démarrage → **607 routes** effectives, pas une estimation par lecture de code.
2. **Appels du navigateur** : 16 fichiers JavaScript publics → **358 couples méthode + URL** distincts → **0 appel sans route** (les 4 écarts apparents étaient des faux positifs : URL composées avec `${…}`).
3. **Liens de page** : 17 liens internes dans les 21 pages HTML → **1 seul anormal**, `/v/` sans code dans `supplier.html` (lien de démonstration à compléter).
4. **Boutons du HTML** : 70 boutons/liens porteurs d'un `id`, **0 sans gestionnaire** (3 faux positifs vérifiés : mot de passe oublié, installation PWA, « Devenir marchand »).
5. **Clics réels (navigateur)** : les 9 rubriques et les 19 entrées de sous-menu ont été cliquées une par une. **Toutes ouvrent le bon panneau**, aucune 404, aucune erreur JavaScript de page.
6. **404 légitimes confirmées** : `/t/` et `/v/` sans code (QR tronqué), `/staff/` (l'espace serveuse est `/equipe/`, aucun lien n'y mène), `/forgot-password/` sans slash (`/forgot-password` répond 200).

> Conclusion de cette étape : **les 404 signalées ne viennent pas de liens cassés**, elles venaient des **401/500 ci-dessus** (le front affichait un écran vide, donc « page introuvable » à l'usage). C'est corrigé et prouvé par les statuts ci-dessus.

## 4. Fonctionnel vérifié de bout en bout (API + relecture)

| Compartiment | Test | Résultat |
|---|---|---|
| Tables | `POST /table-management/tables` (numéro T…, salle, 4 places) | 201, réapparaît dans `GET` |
| Tables | `PUT /points/:id` (capacité 6, zone Terrasse) | 200, relu : zone Terrasse |
| Tables | `POST /points/:id/status` (indisponible) | 200, relu : `inactive` |
| Tables | doublon de numéro | 409 avec message clair (comportement voulu) |
| Produits | `POST /api/merchant/products` (Attiéké poisson, 2 500 F) | 201 |
| Équipe | `POST /api/merchant/team/members` (serveuse) | 201 avec identifiant de connexion |
| Commandes | `POST /api/merchant/assisted-orders` (table + 2 articles + paiement espèces) | 201, référence `OY-…`, statut `pending` |
| Sécurité | `POST /points/:id/qr` par un marchand | **403** « réservé au PDG et aux gestionnaires » (refus côté serveur, pas seulement masqué) |

## 5. Écarts avec la maquette cible (à trancher avant refonte)

| Maquette | Existant aujourd'hui |
|---|---|
| Menu **latéral gauche**, vert foncé, déconnexion en bas | barre d'onglets **horizontale** défilante en haut, déconnexion en bas de page |
| Entrées : Accueil, Commandes, Scanner, **Vue d'ensemble**, **Gestion des tables et espaces**, **Mon équipe ›**, **Voir les historiques**, **Paramètres**, Se déconnecter | Accueil, Commandes, Scanner, **Historiques**, **Tables et espaces**, **Établissement**, **Équipe**, **Finances**, **Réglages** |
| « Vue d'ensemble » = entrée de menu à part | n'existe que comme carte sur l'accueil |
| « Mon équipe › » avec sous-menu | rubrique « Équipe » sans sous-menu permanent (hub intermédiaire) |
| Icônes dans les cellules d'activité (5, 12, 28, 8/10) | chiffres seuls, compteur « 8 / 10 » en fraction |
| Aperçus miniatures des 3 thèmes + bouton « Appliquer » | pastilles de thème + application immédiate |

## 6. Ce qui reste à faire (phase 2 et suivantes)
1. Refonte de l'espace marchand vers la structure de référence (menu latéral).
2. Application éventuelle de cette structure aux autres espaces (PDG, gestionnaire, gérant, serveuse, fournisseur) — **à confirmer**.
3. Reprise des libellés, des icônes d'activité, des compteurs en fraction, des aperçus de thème.
4. Tests par compartiment (rôle autorisé / refusé, création, modification, archivage, persistance après rafraîchissement, déconnexion-reconnexion, historique).
5. Colis delta + rapport final en 9 points.
