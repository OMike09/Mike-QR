# COLIS N°01 — Liens et éléments à héberger

## Routes publiques à publier sur le même domaine

Remplacer `<votre-domaine>` par le domaine que vous allez configurer :

- `https://<votre-domaine>/merchant/` — connexion à l’espace marchand.
- `https://<votre-domaine>/shop/<slug>` — boutique publique d’un marchand, après publication et selon son slug.
- `https://<votre-domaine>/merchant/manifest.webmanifest` — manifeste PWA.
- `https://<votre-domaine>/merchant/sw.js` — service worker PWA.

`/merchant` redirige vers `/merchant/`. Les API restent relatives au même domaine sous `/api/`; elles ne sont pas des fichiers à héberger séparément.

## Ressources locales incluses dans le colis

À copier en conservant leurs chemins sous `public/` :

- `public/icons/qria-logo.png` — logo officiel référencé par l’espace marchand et la boutique.
- `public/icons/qria-180.png`, `qria-192.png`, `qria-512.png`, `qria-512-maskable.png`, `qria-favicon.png` — icônes d’installation et de cache PWA.
- `public/merchant.html`, `public/merchant.js`, `public/merchant.css` — interface marchand.
- `public/shop.html`, `public/shop.js`, `public/shop.css` — vitrine et commande publiques.
- `public/merchant/manifest.webmanifest`, `public/merchant/sw.js` — installation et shell hors ligne.
- `public/fonts/*.woff2` et `public/fonts/licenses/*` — polices auto-hébergées et leurs licences.
- `public/vendor/qrcode.js` avec sa licence et son README — aperçu QR de boutique.

Les CSS, JS, polices, images et API sont prévus pour être servis depuis la même origine; aucune URL CDN n’est requise pour ces éléments.

## Configuration nécessaire avant une vraie mise en ligne

- Définir `PUBLIC_BASE_URL=https://<votre-domaine>` après configuration DNS et HTTPS.
- Configurer `DATABASE_URL` pour la base PostgreSQL de l’environnement. Le schéma fourni est additif; il n’a pas été appliqué à une base réelle dans cette intervention.
- En option, configurer `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` et `WEB_PUSH_SUBJECT` pour activer le push hors application. Sans ces clés, les notifications en direct dans l’espace restent le repli.
- Conserver les secrets dans les variables de l’hébergeur, jamais dans le dépôt. Ne pas déployer le fichier `.env`.

Aucune URL absolue de production n’est connue tant que le domaine n’a pas été renseigné.
