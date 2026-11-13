# COLIS N°01 — Oymike Tech Marchand (essentiel à intégrer / commit)

Ce colis numéroté regroupe le code marchand et boutique, les routes et contrôles serveur, le schéma additif, la PWA, les polices/icônes nécessaires et les tests associés.

## Intégration

Les fichiers conservent leurs chemins de projet. Extrayez-les à la racine de votre dépôt Oymike Tech existant, puis examinez les remplacements avant de les committer. Ce n’est ni un dépôt Git, ni un patch `git apply`.

Le workspace de départ ne contient pas de métadonnées `.git`; aucun commit Git n’a donc été créé. Après intégration et revue dans votre dépôt :

```sh
git add server.js merchant-routes.js merchant-commerce.js manager-routes.js schema.sql .env.example package.json package-lock.json \
  public/merchant.html public/merchant.js public/merchant.css public/merchant/ \
  public/shop.html public/shop.js public/shop.css public/fonts/ public/icons/ public/vendor/ \
  test/merchant-commerce.test.js test/merchant-ui.test.js test/merchant-pwa.test.js
git commit -m "feat: add Oymike Tech merchant workspace and PWA"
```

N’ajoutez pas de `.env`, de base réelle, de secrets ou de données temporaires. Le changement de schéma est additif; validez et exécutez la migration séparément dans l’environnement prévu, après sauvegarde.

## Tests locaux déjà passés

- `npm test` : 27 tests réussis.
- Syntaxe Node des fichiers serveur, scripts et tests : réussie.
- Parcours Chromium local : import/remplacement d’images, conservation du défilement, boutique publique, commande et notification idempotente, compteur lu/non lu, tailles ordinateur/mobile simulées et shell PWA hors ligne.

Cette validation locale n’est pas une validation PostgreSQL, appareil physique, hébergement ou production. L’URL de production, la base et les clés VAPID ne sont pas configurées dans le workspace.

## Fichiers

Voir `LIENS_HEBERGEMENT_COLIS_01.md` pour les routes, ressources statiques à héberger et variables d’environnement nécessaires.
