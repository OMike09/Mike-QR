# COLIS N°04 — Séparer l’entrée marchande des accès PDG/gestionnaire

## Ce que corrige ce colis

La capture montre l’écran « Gestion des marchands », qui est réservé au PDG et aux gestionnaires et comporte leur sélecteur de rôle. Ce n’est pas le formulaire de connexion marchand.

Sur l’hôte exactement égal à la variable `PUBLIC_BASE_URL` :

- la racine `/` et les anciens liens de gestion redirigent vers `/merchant/`;
- les pages de connexion/contrôle PDG et gestionnaire (`/admin`, `/manager`, `/merchant-control` et leurs fichiers HTML directs) redirigent aussi vers l’entrée marchand;
- le même outil de gestion reste accessible depuis l’hôte principal de l’application;
- les API gardent leurs vérifications de rôle côté serveur.

La valeur et le nom de `PUBLIC_BASE_URL` ne sont pas modifiés. Le colis n’ajoute aucun domaine et ne crée aucun compte.

## Fichiers

- `server.js`
- `test/merchant-commerce.test.js`

## Vérification locale

- Test d’intégration avec l’hôte exact `www.march.oymiketech.com` simulé : racine et routes de gestion -> connexion marchand; pages PDG/gestionnaire conservées sur l’hôte principal.
- Identifiants PDG/gestionnaire refusés par l’API de connexion marchande.
- `npm test` : 28/28 réussis.

Ce changement a été fait dans le workspace, mais n’a pas été committé ni déployé sur l’hébergeur. La résolution DNS publique de `www.march.oymiketech.com` échouait encore lors du contrôle; après déploiement et DNS résolu, il faudra retester le lien de production.
