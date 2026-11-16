# Rapport de livraison locale — Commerce marchand Oymike QR

**Date : 10 octobre 2026**  
**État : correction du chargement et liste noire par boutique livrées et testées localement; le périmètre étendu de la nouvelle mission reste partiel.**  
**Aucun déploiement, aucune migration PostgreSQL et aucune écriture en production.**

## Résumé

L’application commerce est étendue sans remplacer les QR, comptes, rôles, boutiques ou données préexistants. Les nouvelles structures PostgreSQL sont additives; en l’absence de `DATABASE_URL`, l’aperçu local utilise le magasin JSON existant. Les tests d’intégration utilisent des fichiers temporaires isolés.

Le serveur d’aperçu écoute sur `0.0.0.0:3001`. Les pages `/`, `/merchant/`, `/discover/` et `/api/health` répondent HTTP 200; l’API PDG protégée renvoie 401 sans session, comme attendu. Le fichier `data/store.json` local conserve ses 5 catégories et contient 0 marchand, boutique, produit, QR d’emplacement, récompense, bon cadeau ou commande; son SHA-256 est resté inchangé pendant ces vérifications. Le serveur d’aperçu utilise une copie isolée sous `/tmp`, pas le magasin original. Le compte local `admin` / `admin1234` est réservé à la démonstration; ne pas le déployer.

## Diagnostic et correction du chargement des détails

La capture montre le texte créé par `selectMerchant()` dans `public/merchant-control.js` pendant l’attente de la requête principale de détail `GET /api/admin/merchants/:id` ou `GET /api/manager/merchants/:id`. Cette interface est en JavaScript DOM natif : il n’y a pas de React ni de `useEffect` à corriger. Le code avait déjà une promesse en vol dédupliquée par identifiant de marchand, un cache de détail de 60 secondes, des chargements séparés par ressource et des garde-fous qui empêchent le polling de remonter le formulaire pendant une saisie ou une création.

**Cause locale vérifiable du chargement qui ne se termine pas :** le helper `api()` n’imposait aucune échéance à `fetch()`. Si la requête du détail restait ouverte sans réponse (serveur, réseau ou base amont bloqués), l’état « Chargement des détails » pouvait donc rester indéfiniment, sans proposer de reprise. La capture seule ne permet pas d’établir pourquoi le serveur de production n’a pas répondu.

**Correction locale :** toutes les requêtes API de cette console sont maintenant annulées après 15 secondes avec `AbortController`; l’interface affiche alors un message d’erreur et un bouton de nouvelle tentative. Les requêtes identiques restent mutualisées. Les changements de champ/photo ne déclenchent pas cette requête; les brouillons restent conservés par les mécanismes existants. Tests ajoutés : requête bloquée → erreur/réessai, sélection répétée → une seule requête, saisie et changement photo → aucun rechargement automatique.

## Mise à jour — restrictions clients par boutique

Le parcours de liste noire est maintenant raccordé aux données JSON locales et au schéma PostgreSQL additif, aux routes API protégées et aux trois interfaces concernées.

- Le marchand peut rechercher/filtrer ses restrictions, ajouter un numéro avec motif, examiner l’historique et les tentatives, puis débloquer sans effacer l’historique. Le bouton depuis une commande préremplit le formulaire; les numéros sont masqués dans l’affichage.
- Le PDG peut superviser les listes globalement et par boutique; le gestionnaire ne voit/modifie que les boutiques où son attribution lui donne le droit de gérer les commandes. Les contrôles sont côté serveur.
- Les numéros sont conservés sous forme d’empreinte HMAC avec suffixe masqué plutôt qu’en clair dans ces enregistrements. Les tentatives de commande bloquées sont comptées et auditées, avec alertes marchand dédupliquées; le message client reste neutre.
- Les demandes de commande répétées sont idempotentes; le même numéro reste autorisé dans une autre boutique. Une annulation légitime ne crée jamais de blocage automatique. Déblocage, motif, événements et tentatives restent consultables.
- Tests ajoutés : création et doublon, masquage, portée boutique, accès gestionnaire autorisé et refusé, refus neutre d’une commande bloquée, déduplication des tentatives/notifications, audit PDG, isolement inter-boutiques, déblocage par gestionnaire/PDG et conservation des commandes/historiques.

## Périmètre livré

- **Boutique marchande et catalogue public :** profils, secteurs restaurant/maquis/quincaillerie/vêtements/général, recherche et découverte publiques, produits, disponibilité et commandes reliées aux stocks côté serveur.
- **Marketing et emplacements :** annonces persistées; QR stables de tables/comptoirs/emplacements, liés à la bonne boutique et transmis à la commande; rendu et téléchargement PNG QR réel.
- **Récompenses gratuites :** tirage fait côté serveur avec `crypto.randomInt`, limites et quantités mises à jour de façon atomique, participation gratuite uniquement, contrôle des lots monétaires, empreinte du participant, code unique, chiffré au repos et consommable une fois.
- **Contrôle réglementaire des offres :** brouillon en pause par défaut; une référence déclarée est soumise à une file PDG; l’activation marchande reste refusée avant examen; le PDG peut approuver, refuser ou révoquer avec note d’audit. Le refus/la révocation met l’offre en pause et la retire immédiatement du catalogue public. Une référence déjà approuvée ne peut pas être remplacée par le marchand.
- **Bons cadeaux hors plateforme :** codes persistés et chiffrés, initialement inactifs; l’activation exige la confirmation du commerçant, sans traitement ni vérification du paiement par Oymike QR; solde et débits contrôlés atomiquement, idempotence et audit.
- **Permissions et traçabilité :** contrôles de périmètre côté serveur pour PDG, gestionnaire et marchand; changements sensibles audités.
- **Conservation et reprise :** migrations SQL additives; identifiants d’idempotence, conservation des brouillons et reprise de commande après coupure réseau; QR historiques stables.

## Précaution réglementaire — Côte d’Ivoire

La loi n°2020-480 du 27 mai 2020 indique à son article 10 que les loteries publicitaires ou promotionnelles requièrent une autorisation préalable. Le communiqué officiel du Conseil des ministres du 6 décembre 2023 décrit le décret encadrant les jeux soumis à autorisation et attribue la délivrance à l’ARJH.

- Texte de loi (Assemblée nationale) : <https://assnat.ci/IMG/pdf/loi_regime_juridique_jeux_de_hasard.pdf>
- Communiqué officiel du Conseil des ministres (06/12/2023) : <https://www.gouv.ci/uploads/publications/1701900269Communique-du-Cosseil-des-Ministres-du-mercredi-06-decembre-2023.pdf>

Le système ne délivre pas d’autorisation et ne consulte pas l’ARJH. Le PDG doit examiner le document officiel hors plateforme avant d’approuver une référence. Cette revue interne ne certifie pas l’authenticité auprès de l’autorité et ne constitue pas un avis juridique; faire confirmer les règles et conditions applicables par l’ARJH ou un conseil ivoirien avant toute campagne. Aucune campagne n’a été exécutée ou autorisée par l’ARJH dans cette session.

## Vérifications exécutées

- `npm test` : **50/50 tests réussis, 0 échec** après les changements de liste noire.
- `node --test test/merchant-commerce.test.js` : **4/4 réussis**, avec création, doublons, isolement boutique, tentatives, audit, permissions et déblocage.
- `node --test test/merchant-control-loading.test.js` : **10/10 réussis**, dont le formulaire de restriction dans le détail PDG et son déblocage.
- `node --test test/merchant-ui.test.js` : **5/5 réussis**, dont les parcours marchand et supervision PDG.
- `node --check` sur tous les fichiers JavaScript du projet : **réussi**; `git diff --check` non disponible (ce dossier n’est pas un dépôt Git).
- Tests HTTP locaux : les parcours marchands et PDG utilisent un serveur de test avec stockage JSON temporaire. Les tests vérifient secteurs, recherche, annonces, QR d’emplacement et commandes, droits, gratuité, blocage des offres sans autorisation revue, file PDG, approbation/refus/révocation, codes à usage unique, stocks concurrents, bons cadeaux, idempotence et restrictions clients.
- Tests d’interface `jsdom` : formulaire marchand, vraie bibliothèque QR canvas, visibilité publique des références, vue PDG de revue, conservation des brouillons/reprises réseau et listes de restrictions. Ces simulations ne constituent pas des tests navigateur réel.

## Écarts encore à réaliser pour la mission complète

Cette livraison corrige le symptôme de chargement bloqué; elle ne clôt pas tous les critères de la demande étendue. L’audit source a confirmé les écarts suivants, à traiter sans migration destructive :

- Les secteurs actifs sont limités à général, restaurant, maquis, quincaillerie et vêtements; les profils supermarché, beauté, hôtel, pharmacie, boulangerie, etc. et leurs champs/unités propres ne sont pas encore implémentés.
- La création rapide demande nom affiché, identifiant, téléphone, e-mail, longueur d’un secret généré et gestionnaire. Elle ne demande pas encore responsable, secteur, ville/adresse, ne permet pas de choisir le secret provisoire et ne vérifie pas la disponibilité de l’identifiant en direct avant soumission.
- Le thème boutique comporte un sous-ensemble de couleurs, polices et mises en page, pas toutes les commandes détaillées (couleurs par élément, réglages typographiques avancés et design complet par secteur).
- Les annonces persistées gèrent titre, message, dates et activation/pause; le constructeur de bandeaux avec image, styles, position, vitesse, répétitions et bouton d’action reste à réaliser.
- La recherche boutique porte sur nom, description, référence SKU et catégorie, avec filtre de catégorie; recherche par marque/référence complète, suggestions, tolérance aux fautes, filtres prix/disponibilité, tri et ouverture d’une fiche dédiée ne sont pas encore couverts.
- Les campagnes de récompenses ont attribution serveur, participation gratuite, limites et codes uniques; le parcours client actuel est un formulaire de participation, pas encore une animation interactive de grattage. Les statuts détaillés et l’interface complète de remise au marchand restent à finaliser.
- Les QR de service couvrent table/comptoir/emplacement et sont reliés à la commande; les statuts d’occupation (libre, occupé, réservé, nettoyage, etc.), historique et affectation/déplacement opérationnels restent à étendre.

## Limites — contrôles non effectués

- Aucun test sur PostgreSQL : aucune `DATABASE_URL` n’était configurée; les migrations additives n’ont pas été exécutées.
- Aucun accès authentifié à Render ou à la base de production; aucun staging, déploiement, changement DNS ou modification de production.
- Aucun essai sur téléphone physique, navigateur graphique réel, impression/scanner physique ou service de paiement.
- Les tests UI sont simulés (`jsdom`); ils ne remplacent pas des essais desktop/mobile réels.
- La revue d’autorisation du PDG repose sur l’examen humain hors plateforme; l’application ne vérifie pas le document auprès de l’ARJH.

## Livraison

Le ZIP d’installation est séparé des données locales et exclut `.env`, `node_modules` et `data/store.json`. Pour un déploiement éventuel, conserver l’URL, le domaine, les variables et la base existants; sauvegarder d’abord, tester les migrations sur une copie de préproduction et ne déployer qu’après validation explicite.
