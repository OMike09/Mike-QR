# Livraison — colis essentiel Oymike Tech QR (mise à jour PWA)

**Date de préparation : 10 octobre 2026**  
**Nature du colis :** code source et tests de l’application existante, avec les trois identités PWA — aucun compte, historique opérationnel, secret ou base de données inclus.

## Contenu livré

Le colis reprend l’application existante et ses dépendances verrouillées (`package-lock.json`), le schéma SQL additif, les interfaces, les API et les tests. Il comprend notamment les parcours suivants :

- **Publicités marchandes** : campagnes, aperçus, publication/gestion et mesures d’impressions/clics côté serveur, avec périmètres PDG/marchand.
- **Récompenses et cartes à gratter** : participation gratuite, tirage/code et inventaire côté serveur, protections anti-doublon et de stock, révélation utilisable au tactile et au clavier, et contrôles d’autorisation explicitement séparés d’une validation réelle par l’ARJH.
- **Commandes assistées** : création à partir du catalogue et du parcours normal de commandes client, avec provenance dédiée, gestion des tables et reçus sans déclarer un paiement non vérifié.
- **Fournisseurs et approvisionnement** : inscription/approbation PDG, catalogue, demandes/devis, commandes distinctes des ventes client, suivi, QR fournisseur stable, notifications et échanges bilatéraux marchand–fournisseur journalisés.
- **Supervision PDG** : vues des campagnes/récompenses, demandes de revue, fournisseurs et commandes d’approvisionnement, avec autorisations par rôle.
- **Trois PWA indépendantes** : PDG `/admin/`, Gestionnaire `/manager/` et Marchand `/merchant/`, avec identifiants, `start_url`, scopes et workers séparés. L’identité graphique PDG est conservée; Gestionnaire et Marchand utilisent l’image fournie, leurs icônes dédiées et des écrans de démarrage iPhone. Les liens personnels Gestionnaire antérieurs restent valides et partagent la même identité Gestionnaire; ils ne remplacent pas la connexion serveur.
- **Installation adaptée au navigateur** : boutons par rôle, prompt natif quand disponible, instructions guidées pour Android/ordinateur et Safari iOS. Les workers PDG/Gestionnaire ne cachent aucune réponse authentifiée; celui du Marchand exclut les routes API de son cache.

## Vérifications effectuées

- `npm test` : **59 réussis, 0 échec, 1 ignoré**. Le test PostgreSQL opt-in a été ignoré; aucune base réelle n’a été testée.
- Tests PWA : routes de connexion, manifestes, identifiants/scopes indépendants, icônes et écrans de démarrage, service workers, boutons et instructions, ainsi que compatibilité des liens personnels Gestionnaire.
- Les tests d’intégration serveur tournent sur un serveur local éphémère avec stockage JSON temporaire; ils couvrent aussi l’authentification, les rôles et les permissions serveur.
- `node --check` sur les fichiers JavaScript modifiés : réussi.

## À ne pas confondre avec une validation de mise en production

- La migration PostgreSQL n’a pas été exécutée sur une base réelle; le parcours PostgreSQL opt-in n’a pas été joué.
- Aucune vérification sur téléphone/navigateur réel ni recette sur le domaine de production n’a été menée.
- Aucune mise en production, modification DNS ou envoi à un destinataire externe n’a été effectué.
- Aucune autorisation ARJH n’a été vérifiée. Les jeux promotionnels ne doivent pas être lancés comme loterie sans examen réglementaire préalable en Côte d’Ivoire.
- Aucun SMS ni paiement n’est déclaré ou intégré dans ce colis.

## Données et secrets exclus

`data/store.json`, les fichiers `.env`, `node_modules/`, les archives antérieures et tout contenu de données locales sont exclus. Le fichier `.env.example` ne contient que des valeurs fictives/instructions. L’application existante, ses QR, comptes, commandes et données ne sont pas remplacés ni copiés dans cette archive.

## Démarrage local indicatif

1. Utiliser Node.js 20 ou supérieur.
2. Installer les dépendances avec `npm ci`.
3. Pour un essai local isolé, copier `.env.example` vers `.env` et remplacer chaque valeur d’exemple par des valeurs locales dédiées; ne jamais réutiliser les secrets de production.
4. Démarrer avec `npm start`.

Avant toute utilisation avec une base existante, prendre une sauvegarde vérifiée, examiner le schéma additif, tester sur une base de préproduction et obtenir l’autorisation opérationnelle appropriée. Le colis n’exécute aucune migration ni déploiement de sa propre initiative.
