# Paquet essentiel — correction QR Oymike Tech

Ce ZIP est un overlay des fichiers source essentiels, pas un `git format-patch` : le dossier `/home/user/qr-studio` n’est pas un dépôt Git dans cet environnement. Extraire à côté du dossier `qr-studio` pour garder les chemins relatifs.

## Contenu

- `qr-studio/manager-routes.js`
- `qr-studio/request-integrity.js`
- `qr-studio/server.js`
- `qr-studio/store.js`
- `qr-studio/schema.sql`
- `qr-studio/public/qr-artwork.js`
- `qr-studio/public/qr-wizard.js`
- `qr-studio/public/qr-wizard.css`
- `qr-studio/public/admin.js`
- `qr-studio/public/admin.css`
- `qr-studio/public/manager.js`
- `qr-studio/public/manager.css`
- `qr-studio/test/qr-profile-workflow.test.js`
- `qr-studio/test/qr-artwork.test.js`
- `qr-studio/test/qr-theme-editor.test.js`

## Résumé

- Remplacement du rendu d’aperçu `blob:` bloqué par la CSP par `data:`.
- Validation du contenu avant création d’un bénéficiaire, pour éviter les enregistrements orphelins en cas de formulaire incomplet.
- Reprise idempotente admin/gestionnaire et comparaison stable malgré les identifiants générés côté serveur.
- Succès affiché après confirmation de l’identifiant, du bénéficiaire, de la route publique et du rendu réel.
- Couverture de tests CSP, téléchargements SVG/PNG, reprises réseau et workflows QR.

## Vérification locale

- `npm test` : 19/19 réussis.
- `npm audit` : 0 vulnérabilité.
- Tests end-to-end Chromium sur stockage JSON temporaire; PNG et SVG téléchargés puis décodés automatiquement.
- Aucun déploiement Render, test PostgreSQL de production ni scan physique effectué.

## Message de commit suggéré

`fix(qr): rétablir le rendu CSP et sécuriser les reprises de création`

Ce paquet ne contient aucune donnée de base, aucun compte, aucun QR utilisateur et aucun secret.
