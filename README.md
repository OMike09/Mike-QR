# QRia — Administration centralisée des QR codes

QRia est une application web en français pour qu’un administrateur unique gère les profils de particuliers, d’entreprises, de commerces et d’organisations, ainsi que plusieurs QR codes par bénéficiaire.

## Fonctionnalités

- Connexion réservée à l’administrateur principal — aucun compte bénéficiaire ni inscription publique.
- Création, recherche, modification, activation, désactivation, archivage et suppression logique des bénéficiaires et QR codes.
- Plusieurs codes par bénéficiaire, catégories personnalisables, identifiant public unique et journal de modifications.
- Pages QRia mobiles modifiables après impression, ou redirection modifiable vers un site externe.
- Choix des champs visibles par QR : photo/logo, téléphone, WhatsApp, e-mail, adresse, localisation, site, réseaux, présentation, offres, tarifs, documents et liens utiles.
- Import de logos/photos PNG, JPEG ou WebP (850 Ko maximum), ou lien HTTPS.
- Téléchargement PNG/SVG, copie du lien, impression et comptage des ouvertures/scans.
- Tableau paginé et recherche côté serveur, adapté aux grands répertoires.
- La page publique n’affiche que les champs sélectionnés. Les statistiques ne stockent ni adresse IP ni agent utilisateur.
- Le générateur local historique (lien/texte/Wi-Fi, PNG/SVG) est conservé sous `/generator.html`.

## Lancer en local

Node.js 20 ou plus récent est requis.

```bash
npm install
npm start
```

Ouvrir `http://localhost:3000`. Sans `DATABASE_URL`, l’aperçu local enregistre ses données dans `data/store.json` et utilise le compte de démonstration `admin` / `admin1234`. Ce mode JSON et ce compte ne doivent pas être utilisés pour un déploiement public.

Pour utiliser une base PostgreSQL en local, créez un fichier `.env` à partir de `.env.example`, renseignez `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` et `SESSION_SECRET`, puis lancez `npm start`. Le schéma et les index sont créés automatiquement au démarrage.

## Déploiement Render + Neon

Cette version possède une API et une authentification : déployez-la comme **Web Service Node**, pas comme Static Site.

1. Envoyez à GitHub le contenu de ce dossier : `package.json`, `package-lock.json`, `server.js`, `store.js`, `schema.sql` et `public/`.
2. Sur Render, créez un **New Web Service** relié à ce dépôt.
3. Réglages si les fichiers sont à la racine du dépôt :
   - **Root Directory** : vide
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Dans **Environment**, ajoutez les variables suivantes :
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = chaîne de connexion PostgreSQL Neon (à copier depuis **Connect** dans Neon)
   - `ADMIN_USERNAME` = l’identifiant de l’administrateur (au moins 3 caractères)
   - `ADMIN_PASSWORD` = son mot de passe fort, d’au moins 12 caractères
   - `SESSION_SECRET` = une chaîne aléatoire secrète d’au moins 32 caractères
5. Enregistrez et déployez. La base doit être accessible au service Render; QRia crée les tables et index au premier démarrage.

Ne mettez jamais `.env`, `DATABASE_URL`, le mot de passe administrateur ni `SESSION_SECRET` dans GitHub. Ils vont uniquement dans les variables d’environnement Render.

## Architecture

- `server.js` : serveur Express, API d’administration, session signée, liens publics `/r/:code`.
- `store.js` : stockage PostgreSQL via `pg` en déploiement; stockage JSON local uniquement pour l’aperçu de développement.
- `schema.sql` : bénéficiaires, catégories, QR codes, scans et journal d’audit.
- `public/index.html` : tableau de bord administrateur.
- `public/profile.html` : page mobile publique d’un QR hébergé.
- `public/generator.html` : ancien générateur autonome conservé.
- Les QR hébergés encodent une URL stable `/r/<identifiant>`. Modifier la page ou la destination n’oblige donc pas à réimprimer le QR.
