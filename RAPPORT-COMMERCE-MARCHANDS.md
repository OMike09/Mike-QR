# Rapport — Comptes marchands et commerce Oymike Tech

**Date : 10 octobre 2026**  
**Périmètre testé : stockage JSON local isolé**

## Résultat

Le parcours marchand est intégré au système PDG/gestionnaires et aux QR existants. Le PDG dispose du contrôle global. Les gestionnaires sont limités par leur permission globale et leurs attributions par marchand. Un marchand n’accède qu’à son espace et l’API refuse explicitement toute création de QR avec une session marchande.

Aucun système de paiement en ligne n’a été ajouté.

## Fonctionnalités ajoutées

- Création de comptes marchands avec identifiants temporaires à usage initial, changement obligatoire du mot de passe, suspension/réactivation et révocation des sessions.
- Permission PDG `canManageMerchants` pour les gestionnaires, désactivée par défaut; attributions par marchand pour boutique, produits/stocks, commandes, QR et journal.
- Boutique publique avec informations de contact, publication et catalogue actualisé; gestion des produits, disponibilités et archivage.
- Commandes clients sans compte, validation de stock côté serveur, clé idempotente et suivi privé par jeton. L’annulation d’une commande réservée restitue le stock.
- Statuts de commande, journal d’audit, statistiques et notification SSE des nouvelles commandes.
- Console de gestion PDG/gestionnaire et espace marchand; liens ajoutés aux navigations existantes. Les QR de boutique restent créés par le PDG ou un gestionnaire autorisé et pointent vers une adresse stable.
- Après une erreur réseau ambiguë, le panier, le contenu exact de la commande et sa clé idempotente sont conservés en `sessionStorage`. Les champs sont verrouillés jusqu’à la reprise, afin de renvoyer la même intention au lieu de créer par inadvertance une seconde commande.
- Migration additive dans `schema.sql`; les tables et données QR existantes ne sont pas remplacées.

## Fichiers concernés

- **Serveur, rôles et stockage :** `server.js`, `store.js`, `manager-routes.js`, `merchant-commerce.js`, `merchant-routes.js`, `schema.sql`.
- **Console PDG/gestionnaire :** `public/admin.js`, `public/index.html`, `public/manager.html`, `public/merchant-control.html`, `public/merchant-control.css`, `public/merchant-control.js`.
- **Espace marchand et parcours client :** `public/merchant.html`, `public/merchant.css`, `public/merchant.js`, `public/shop.html`, `public/shop.css`, `public/shop.js`, `public/order-tracking.html`, `public/order-tracking.js`.
- **Tests :** `test/merchant-commerce.test.js`, `test/shop-order-recovery.test.js`.

## Vérifications effectivement réalisées

- `npm test` : **24/24 tests réussis** à l’état final.
- `node --test test/merchant-commerce.test.js test/shop-order-recovery.test.js` : **3/3 sous-tests réussis**.
- `node --check` : syntaxe vérifiée pour les fichiers JavaScript serveur, client et tests concernés.
- Test HTTP sur serveur de test isolé : `/vendor/qrcode.js` est servi; la page de console référence bien cet asset. Les routes de lecture/création QR PDG/gestionnaire, les portées et le refus d’accès QR marchand ont été exercés.
- Tests d’intégration JSON : comptes temporaires, changement de mot de passe, catalogue, contrôle de stock, idempotence, suivi privé, SSE, transitions de commande, restitution de stock après annulation, audit, suspension, isolation et permissions gestionnaire.
- Test DOM simulé (`jsdom`) : après coupure réseau puis rechargement, le panier, les données de commande et le même identifiant idempotent sont réutilisés; une réponse passerelle 504 conserve la tentative.

## Limites — ne pas confondre avec une validation de déploiement

- La migration SQL n’a **pas** été exécutée sur PostgreSQL : aucun `psql` ni `DATABASE_URL` n’était disponible. Seule la structure additive a été contrôlée par test; les requêtes PostgreSQL doivent être vérifiées sur une base de préproduction.
- Aucun test visuel dans un navigateur graphique n’a été réalisé : aucun Chromium/Firefox ni Playwright/Puppeteer n’était disponible dans l’environnement. Les vérifications d’interface sont statiques et DOM-simulées.
- Aucun test sur téléphone physique, Render, données de production ou environnement de production n’a été réalisé.
- Les tests de stockage utilisent un fichier JSON temporaire isolé; ils ne modifient pas les données de production.

## Suite recommandée avant déploiement

1. Sauvegarder les données, appliquer `schema.sql` sur une copie de préproduction PostgreSQL, puis exécuter les parcours marchand/gestionnaire/PDG sur cette base.
2. Faire un smoke test visuel sur navigateur desktop et mobile, notamment création de boutique, affichage/téléchargement du QR, commande client et reprise après perte réseau.
3. Valider l’URL publique HTTPS et les règles d’accès en staging avant tout déploiement Render ou production.
