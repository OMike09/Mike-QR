# COLIS N°03 — Utiliser le domaine marchand déjà configuré

## Objectif

Rendre l’adresse enregistrée dans `PUBLIC_BASE_URL` utilisable directement comme entrée de l’espace marchand, sans changer le nom ni la valeur de cette variable et sans créer de domaine supplémentaire.

## Changement inclus

- Quand l’hôte de la requête correspond à `PUBLIC_BASE_URL`, la racine `/` redirige vers `/merchant/`, qui affiche la connexion marchande.
- `/merchant` se canonise vers `/merchant/` et une entrée marchande servie depuis un autre hôte est redirigée vers le domaine déjà configuré.
- Sur un autre hôte, la route racine existante de l’application principale reste inchangée.
- Les tests vérifient le nom exact `www.march.oymiketech.com` en environnement local avec en-têtes d’hôte simulés, le rejet des identifiants PDG/gestionnaire par la connexion marchande et le retour à la connexion après déconnexion.

La valeur de `PUBLIC_BASE_URL` n’est pas incluse dans un `.env` de production et n’a pas été modifiée par ce colis. Le test local simule l’hôte; il ne prouve pas que le DNS public ou l’hébergement servent déjà l’application.

## Fichiers du colis

- `server.js`
- `test/merchant-commerce.test.js`
- `test/merchant-ui.test.js`

## Validation

- `npm test` : 28/28 réussis.
- `node --check` des scripts serveur et tests concernés : réussi.
- Pas de commit Git ni de déploiement effectué depuis ce workspace (aucun dépôt `.git` ni accès à l’hébergeur).

Le DNS public de `www.march.oymiketech.com` ne résolvait pas lors de la dernière vérification externe; les tests de production sur ce domaine restent donc à refaire après raccordement DNS. Le colis n°01 ne suffit pas à rendre la racine dédiée si le code déployé ne comporte pas ce changement n°03.
